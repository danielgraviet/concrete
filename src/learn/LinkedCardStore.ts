import { cleanLinkedInput, type LinkedCard, type LinkedCardInput } from './LinkedCards';
import { CARDS_LEGACY_FILE, CARDS_MANIFEST_FILE, CARDS_SHARD_COUNT, cardsShardFile, cardShardOf } from './cardShards';
import { getBackend } from '../backend';

/** Format v1 (one file holding every card). Migrated to v2 shards on first load; see `cardShards.ts`. */
export const LINKED_CARDS_FILE = CARDS_LEGACY_FILE;

const MAX_SHARDS = 4096;

type CardsFile = {
  version: 1;
  cards: LinkedCard[];
  /** When `## Flashcards` sections were moved out of notes (once per vault). */
  migratedAt?: number;
};

type Manifest = { version: 2; shards: number; migratedAt?: number };
/** `seq` is the card's position in creation order; `all()` is sorted by it. */
type ShardFile = { version: 2; shard: number; cards: Array<{ seq: number; card: LinkedCard }> };

/**
 * Access to `.vault/` data files by name: the vault data API (desktop disk or
 * web cloud store), else localStorage (demo mode, older Electron).
 */
export type LinkedCardDataAdapter = {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  /** Missing when the backend can't delete; a migrated v1 file is then left in place (and ignored). */
  remove?(name: string): Promise<void>;
};

function adapterFor(root: string): LinkedCardDataAdapter {
  const api = getBackend().vault;
  if (root && api?.readData && api.writeData) {
    const { readData, writeData, deleteData } = api;
    const adapter: LinkedCardDataAdapter = {
      read: (name) => readData(root, name),
      write: async (name, content) => {
        await writeData(root, name, content);
      },
    };
    if (deleteData) {
      adapter.remove = async (name) => {
        await deleteData(root, name);
      };
    }
    return adapter;
  }
  // Same key scheme as before, so demo-mode cards migrate like a vault's.
  const keyFor = (name: string) => `mv:${name}:${root || '__demo__'}`;
  return {
    read: async (name) => {
      try {
        return localStorage.getItem(keyFor(name));
      } catch {
        return null;
      }
    },
    write: async (name, content) => {
      try {
        localStorage.setItem(keyFor(name), content);
      } catch {
        // Storage full/unavailable — cards just won't persist in demo mode.
      }
    },
    remove: async (name) => {
      try {
        localStorage.removeItem(keyFor(name));
      } catch {
        // Ignore.
      }
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLinkedCard(value: unknown): value is LinkedCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  if (typeof card.uid !== 'string' || typeof card.path !== 'string' || (card.folder !== undefined && typeof card.folder !== 'string')) return false;
  if (card.kind === 'basic') return typeof card.front === 'string' && typeof card.back === 'string';
  if (card.kind === 'cloze') return typeof card.text === 'string';
  if (card.kind === 'mcq') return typeof card.prompt === 'string' && Array.isArray(card.options);
  return false;
}

function newUid(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `lc-${random}`;
}

/** Write data to any `.vault/*.json` file (used for the migration backup). */
export async function writeVaultData(root: string, name: string, content: string): Promise<void> {
  await adapterFor(root).write(name, content);
}

class UnreadableError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super(`could not read ${file}`, { cause });
  }
}

/**
 * Cards made in the app, each linked to a note by path. Writes go straight to
 * storage (in order) so a card is saved before the panel says it was added.
 *
 * Stored as a manifest plus card shards (see `cardShards.ts`); a change writes
 * only the shards holding cards it added, edited or removed, then the manifest
 * if `migratedAt` changed.
 */
export class LinkedCardStore {
  private data: CardsFile = { version: 1, cards: [] };
  private adapter: LinkedCardDataAdapter;
  private listeners = new Set<() => void>();
  private loaded = false;
  /** Storage exists but couldn't be read: never overwrite it. */
  private unreadable = false;
  private unreadableFile = CARDS_MANIFEST_FILE;
  private writing: Promise<void> = Promise.resolve();
  /** Shard count this vault was written with (from its manifest). */
  private shardCount = CARDS_SHARD_COUNT;
  /** Creation order of each card (uid → seq). */
  private seqs = new Map<string, number>();
  private nextSeq = 0;
  /** Shards that must be rewritten on the next save (migration, or a save that failed part-way). */
  private pendingShards = new Set<number>();
  private pendingManifest = false;
  private manifestOnDisk = false;
  private legacyOnDisk = false;
  version = 0;

  constructor(root: string, adapter?: LinkedCardDataAdapter) {
    this.adapter = adapter ?? adapterFor(root);
  }

  async load(): Promise<void> {
    let migrate = false;
    try {
      migrate = await this.readStorage();
    } catch (error) {
      console.error('[cards] could not read linked cards; they will not be saved this session', error);
      this.data = { version: 1, cards: [] };
      this.seqs.clear();
      this.unreadable = true;
      if (error instanceof UnreadableError) this.unreadableFile = error.file;
    }
    this.loaded = true;
    this.emit();
    if (migrate) {
      const run = this.writing.then(() => this.persist(this.data));
      this.writing = run.catch((error: unknown) => {
        // Stays pending: the next change retries, and until the manifest is written the next load migrates again.
        console.error('[cards] could not finish migrating linked cards', error);
      });
      await this.writing;
    }
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Loaded and safe to write. */
  get isWritable(): boolean {
    return this.loaded && !this.unreadable;
  }

  get migratedAt(): number | undefined {
    return this.data.migratedAt;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  all(): LinkedCard[] {
    return this.data.cards;
  }

  get(uid: string): LinkedCard | undefined {
    return this.data.cards.find((card) => card.uid === uid);
  }

  async add(path: string, input: LinkedCardInput, now = Date.now()): Promise<LinkedCard> {
    const [card] = await this.addMany([{ path, input }], now);
    return card;
  }

  async addToFolder(folder: string, input: LinkedCardInput, now = Date.now()): Promise<LinkedCard> {
    const [card] = await this.addMany([{ path: '', input, folder }], now);
    return card;
  }

  async addMany(items: Array<{ path: string; input: LinkedCardInput; folder?: string }>, now = Date.now(), migratedAt?: number): Promise<LinkedCard[]> {
    const created = items.map(({ path, input, folder }) => ({ ...cleanLinkedInput(input), uid: newUid(), path, created: now, ...(folder ? { folder } : {}) }) as LinkedCard);
    await this.commit((data) => ({
      ...data,
      cards: [...data.cards, ...created],
      ...(migratedAt !== undefined ? { migratedAt } : {}),
    }));
    return created;
  }

  async update(uid: string, input: LinkedCardInput): Promise<LinkedCard> {
    let next: LinkedCard | undefined;
    await this.commit((data) => {
      const existing = data.cards.find((card) => card.uid === uid);
      if (!existing) throw new Error('That card no longer exists.');
      const updated = { ...cleanLinkedInput(input), uid, path: existing.path, created: existing.created, ...(existing.folder ? { folder: existing.folder } : {}) } as LinkedCard;
      next = updated;
      return { ...data, cards: data.cards.map((card) => (card.uid === uid ? updated : card)) };
    });
    return next!;
  }

  async remove(uids: string[]): Promise<void> {
    const drop = new Set(uids);
    await this.commit((data) =>
      data.cards.some((card) => drop.has(card.uid)) ? { ...data, cards: data.cards.filter((card) => !drop.has(card.uid)) } : null,
    );
  }

  async markMigrated(at: number): Promise<void> {
    await this.commit((data) => ({ ...data, migratedAt: at }));
  }

  /** Keep cards linked when a note or folder is renamed or moved. */
  async renamePath(from: string, to: string, kind: 'file' | 'folder'): Promise<void> {
    const moved = (path: string) => {
      if (kind === 'file') return path === from ? to : path;
      return path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    };
    const changes = (card: LinkedCard) => moved(card.path) !== card.path || (card.folder ? moved(card.folder) !== card.folder : false);
    await this.commit((data) =>
      data.cards.some(changes)
        ? // Unchanged cards keep their object, so only shards with moved cards are rewritten.
          { ...data, cards: data.cards.map((card) => (changes(card) ? { ...card, path: moved(card.path), ...(card.folder ? { folder: moved(card.folder) } : {}) } : card)) }
        : null,
    );
  }

  /** Persist `change(current)` (null = no change), then make it current. On failure nothing changes. */
  private commit(change: (data: CardsFile) => CardsFile | null): Promise<void> {
    const run = this.writing.then(async () => {
      if (!this.loaded) throw new Error('Cards are still loading. Try again in a moment.');
      if (this.unreadable) throw new Error(`Could not read ${this.unreadableFile}, so the saved cards were left untouched. Fix or remove it, then reopen the vault.`);
      const next = change(this.data);
      if (!next) return;
      await this.persist(next);
      this.emit();
    });
    this.writing = run.catch(() => {});
    return run;
  }

  /**
   * Read v2 (manifest + shards), else migrate v1. Returns true when the loaded
   * cards still have to be written as v2. Throws when anything can't be read
   * or parsed, so the caller never overwrites data it didn't see.
   */
  private async readStorage(): Promise<boolean> {
    const manifestText = await this.read(CARDS_MANIFEST_FILE);
    if (manifestText !== null) {
      await this.readV2(manifestText);
      return false;
    }

    this.shardCount = CARDS_SHARD_COUNT;
    const legacyText = await this.read(CARDS_LEGACY_FILE);
    if (!legacyText) return false;
    let raw: Partial<CardsFile>;
    try {
      raw = JSON.parse(legacyText) as Partial<CardsFile>;
    } catch (error) {
      throw new UnreadableError(CARDS_LEGACY_FILE, error);
    }
    const cards = Array.isArray(raw.cards) ? raw.cards.filter(isLinkedCard) : [];
    this.data = { version: 1, cards, ...(typeof raw.migratedAt === 'number' ? { migratedAt: raw.migratedAt } : {}) };
    cards.forEach((card, i) => this.seqs.set(card.uid, i));
    this.nextSeq = cards.length;
    this.legacyOnDisk = true;
    // Write every shard (overwriting leftovers from an interrupted migration),
    // then the manifest last: until it exists, the next load migrates again.
    for (let i = 0; i < this.shardCount; i += 1) this.pendingShards.add(i);
    this.pendingManifest = true;
    return true;
  }

  private async readV2(manifestText: string): Promise<void> {
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      throw new UnreadableError(CARDS_MANIFEST_FILE, error);
    }
    if (!isObject(manifest)) throw new UnreadableError(CARDS_MANIFEST_FILE, new Error('not an object'));
    const count = manifest.shards;
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || count > MAX_SHARDS) {
      throw new UnreadableError(CARDS_MANIFEST_FILE, new Error(`bad shard count ${String(count)}`));
    }
    this.shardCount = count;
    this.manifestOnDisk = true;

    const texts = await Promise.all(Array.from({ length: count }, (_, i) => this.read(cardsShardFile(i))));
    const entries: Array<{ seq: number; card: LinkedCard }> = [];
    texts.forEach((text, i) => {
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new UnreadableError(cardsShardFile(i), error);
      }
      if (!isObject(parsed) || !Array.isArray(parsed.cards)) throw new UnreadableError(cardsShardFile(i), new Error('no cards array'));
      for (const entry of parsed.cards as unknown[]) {
        if (isObject(entry) && typeof entry.seq === 'number' && isLinkedCard(entry.card)) entries.push({ seq: entry.seq, card: entry.card });
      }
    });
    entries.sort((a, b) => a.seq - b.seq);
    for (const { seq, card } of entries) this.seqs.set(card.uid, seq);
    this.nextSeq = entries.length ? entries[entries.length - 1].seq + 1 : 0;
    this.data = {
      version: 1,
      cards: entries.map((entry) => entry.card),
      ...(typeof manifest.migratedAt === 'number' ? { migratedAt: manifest.migratedAt } : {}),
    };
  }

  private async read(name: string): Promise<string | null> {
    try {
      return await this.adapter.read(name);
    } catch (error) {
      throw new UnreadableError(name, error);
    }
  }

  private manifestText(file: CardsFile): string {
    const manifest: Manifest = { version: 2, shards: this.shardCount, ...(file.migratedAt !== undefined ? { migratedAt: file.migratedAt } : {}) };
    return JSON.stringify(manifest);
  }

  /**
   * Write what changed between the current cards and `next`, then make `next`
   * current. Shards go first and the manifest last. Throws (leaving the
   * current cards in place) if any write fails; whatever was attempted is
   * rewritten from memory on the next save.
   */
  private async persist(next: CardsFile): Promise<void> {
    const before = new Map(this.data.cards.map((card) => [card.uid, card]));
    const after = new Map(next.cards.map((card) => [card.uid, card]));
    const shards = new Set(this.pendingShards);
    for (const [uid, card] of after) if (before.get(uid) !== card) shards.add(cardShardOf(uid, this.shardCount));
    for (const uid of before.keys()) if (!after.has(uid)) shards.add(cardShardOf(uid, this.shardCount));
    const writeManifest = this.pendingManifest || !this.manifestOnDisk || next.migratedAt !== this.data.migratedAt;

    // Creation order for new cards; dropped cards forget theirs.
    const seqs = new Map<string, number>();
    let nextSeq = this.nextSeq;
    for (const card of next.cards) seqs.set(card.uid, this.seqs.get(card.uid) ?? nextSeq++);

    const buckets = new Map<number, ShardFile['cards']>([...shards].map((i) => [i, []]));
    for (const card of next.cards) buckets.get(cardShardOf(card.uid, this.shardCount))?.push({ seq: seqs.get(card.uid)!, card });

    const attempt = (written: Iterable<number>, manifest: boolean) => {
      for (const i of written) this.pendingShards.add(i);
      if (manifest) this.pendingManifest = true;
    };

    // A brand-new vault has neither a manifest nor a legacy file to fall back
    // on: write the (current) manifest first so shards are never orphaned.
    if (!this.manifestOnDisk && !this.legacyOnDisk && shards.size > 0) {
      await this.adapter.write(CARDS_MANIFEST_FILE, this.manifestText(this.data));
      this.manifestOnDisk = true;
    }

    const results = await Promise.allSettled(
      [...buckets].map(([i, cards]) => {
        const file: ShardFile = { version: 2, shard: i, cards };
        return this.adapter.write(cardsShardFile(i), JSON.stringify(file));
      }),
    );
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      attempt(shards, writeManifest);
      throw failure.reason;
    }
    if (writeManifest) {
      try {
        await this.adapter.write(CARDS_MANIFEST_FILE, this.manifestText(next));
      } catch (error) {
        attempt(shards, true);
        throw error;
      }
    }

    this.pendingShards.clear();
    this.pendingManifest = false;
    this.manifestOnDisk = true;
    this.data = next;
    this.seqs = seqs;
    this.nextSeq = nextSeq;

    if (this.legacyOnDisk && this.adapter.remove) {
      try {
        await this.adapter.remove(CARDS_LEGACY_FILE);
        this.legacyOnDisk = false;
      } catch (error) {
        console.error(`[cards] could not remove migrated ${CARDS_LEGACY_FILE}`, error);
      }
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
