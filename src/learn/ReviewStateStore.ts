import { cardFingerprint } from './cardId';
import { planMigrations } from './reconcile';
import { newSched, type Scheduler } from './scheduler';
import { LEGACY_FILE, LOG_FILE, MANIFEST_FILE, SHARD_COUNT, shardFile, shardOf } from './srsShards';
import { studyDay } from './studyDay';
import type { DayStats, Rating, ReviewCard, SrsFile, StoredCard } from './types';
import { getBackend } from '../backend';

const SAVE_DELAY_MS = 400;
const ORPHAN_GRACE_MS = 30 * 24 * 3600_000;
const KEEP_DAYS = 400;
const MAX_SHARDS = 4096;

function emptyFile(): SrsFile {
  return { version: 1, cards: {}, days: {}, quizzes: {}, quizSyncAt: 0 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Global (non-card) fields of a v1 file or a v2 manifest. */
function coerceGlobals(file: SrsFile, raw: unknown): void {
  if (!isObject(raw)) return;
  if (isObject(raw.days)) file.days = raw.days as SrsFile['days'];
  if (isObject(raw.quizzes)) file.quizzes = raw.quizzes as SrsFile['quizzes'];
  if (typeof raw.quizSyncAt === 'number') file.quizSyncAt = raw.quizSyncAt;
}

/** A v1 file (`.vault/srs.json`). */
function coerce(raw: unknown): SrsFile {
  const file = emptyFile();
  if (!isObject(raw)) return file;
  if (isObject(raw.cards)) file.cards = raw.cards as SrsFile['cards'];
  coerceGlobals(file, raw);
  return file;
}

type Manifest = {
  version: 2;
  shards: number;
  days: SrsFile['days'];
  quizzes: SrsFile['quizzes'];
  quizSyncAt: number;
};

type ShardFile = { version: 2; shard: number; cards: SrsFile['cards'] };

type Undo = { id: string; before: StoredCard | undefined; day: string; dayBefore: DayStats | undefined };

/**
 * Access to `.vault/` data files by name: the vault data API (desktop disk or
 * web cloud store), else localStorage (demo mode, older Electron).
 */
export type ReviewDataAdapter = {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  append(name: string, line: string): Promise<void>;
  /** Missing when the backend can't delete; a migrated v1 file is then left in place (and ignored). */
  remove?(name: string): Promise<void>;
};

function adapterFor(root: string): ReviewDataAdapter {
  const api = getBackend().vault;
  if (root && api?.readData && api.writeData && api.appendData) {
    const { readData, writeData, appendData, deleteData } = api;
    const adapter: ReviewDataAdapter = {
      read: (name) => readData(root, name),
      write: async (name, content) => {
        await writeData(root, name, content);
      },
      append: async (name, line) => {
        await appendData(root, name, line);
      },
    };
    if (deleteData) {
      adapter.remove = async (name) => {
        await deleteData(root, name);
      };
    }
    return adapter;
  }
  // The v1 key is unchanged so demo-mode state migrates like a vault's.
  const base = `mv:srs:${root || '__demo__'}`;
  const keyFor = (name: string) => (name === LEGACY_FILE ? base : `${base}:${name}`);
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
        // Storage full/unavailable — review state just won't persist.
      }
    },
    append: async () => {},
    remove: async (name) => {
      try {
        localStorage.removeItem(keyFor(name));
      } catch {
        // Ignore.
      }
    },
  };
}

/**
 * Review history for every card, keyed by card id. Card *content* is never
 * stored here — it lives in the notes — only scheduling plus enough text to
 * re-attach history when a card is edited or moved.
 *
 * Stored as a manifest plus card shards (see `srsShards.ts`); a save writes
 * only the shards whose cards changed, then the manifest if global fields did.
 */
export class ReviewStateStore {
  private data: SrsFile = emptyFile();
  private adapter: ReviewDataAdapter;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: Undo[] = [];
  private loaded = false;
  /** Shard count this vault was written with (from its manifest). */
  private shardCount = SHARD_COUNT;
  private dirtyShards = new Set<number>();
  private manifestDirty = false;
  /** Shards that failed to read: never overwritten this session. */
  private blockedShards = new Set<number>();
  /** Storage couldn't be read at all: never write, so nothing on disk is clobbered. */
  private readOnly = false;
  /** A v1 file was migrated and should be deleted once the manifest is on disk. */
  private legacyToRemove = false;
  /** Saves run one at a time, in order. */
  private saving: Promise<void> = Promise.resolve();
  version = 0;

  constructor(
    private root: string,
    adapter?: ReviewDataAdapter,
  ) {
    this.adapter = adapter ?? adapterFor(root);
  }

  async load(): Promise<void> {
    let migrate = false;
    try {
      migrate = await this.readStorage();
    } catch (error) {
      console.error('[srs] could not read review state; changes will not be saved this session', error);
      this.data = emptyFile();
      this.readOnly = true;
    }
    this.loaded = true;
    this.emit();
    if (migrate) await this.persist();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get(id: string): StoredCard | undefined {
    return this.data.cards[id];
  }

  today(now: number): DayStats {
    return this.data.days[studyDay(now)] ?? { newSeen: 0, reviews: 0, again: 0 };
  }

  isQuizEnabled(path: string): boolean {
    return this.data.quizzes[path]?.enabled === true;
  }

  get quizSyncAt(): number {
    return this.data.quizSyncAt;
  }

  /** Quiz questions are only reviewed when their quiz is enabled or they were enrolled (missed). */
  isActive(card: ReviewCard): boolean {
    if (card.source.origin !== 'quiz') return true;
    return this.isQuizEnabled(card.source.path) || this.data.cards[card.id]?.enrolled === true || Boolean(this.data.cards[card.id]?.sched);
  }

  setQuizEnabled(path: string, enabled: boolean): void {
    if (enabled) this.data.quizzes[path] = { enabled: true };
    else delete this.data.quizzes[path];
    this.manifestDirty = true;
    this.changed();
  }

  /** Put quiz questions into review, due now, ahead of other new cards. */
  enroll(cards: ReviewCard[], now: number, syncAt?: number): void {
    for (const card of cards) {
      const existing = this.data.cards[card.id];
      if (existing?.sched && existing.sched.state !== 0) {
        // Already being reviewed — a missed quiz question should come back soon.
        if (existing.sched.due > now) {
          existing.sched = { ...existing.sched, due: now };
          this.touch(card.id);
        }
        continue;
      }
      this.put(card.id, {
        ...this.entryFor(card),
        sched: { ...newSched(now), due: now },
        enrolled: true,
      });
    }
    if (syncAt !== undefined) {
      this.data.quizSyncAt = Math.max(this.data.quizSyncAt, syncAt);
      this.manifestDirty = true;
    }
    this.changed();
  }

  review(card: ReviewCard, rating: Rating, now: number, scheduler: Scheduler): StoredCard {
    const before = this.data.cards[card.id];
    const day = studyDay(now);
    const dayBefore = this.data.days[day];
    this.undoStack.push({ id: card.id, before: before ? structuredClone(before) : undefined, day, dayBefore: dayBefore ? { ...dayBefore } : undefined });
    if (this.undoStack.length > 50) this.undoStack.shift();

    const wasNew = !before?.sched || before.sched.state === 0;
    const sched = scheduler.next(before?.sched, rating, now);
    const entry: StoredCard = { ...this.entryFor(card), ...(before?.enrolled ? { enrolled: true } : {}), sched };
    this.put(card.id, entry);

    const stats = { ...(dayBefore ?? { newSeen: 0, reviews: 0, again: 0 }) };
    stats.reviews += 1;
    if (wasNew) stats.newSeen += 1;
    if (rating === 'again') stats.again += 1;
    this.data.days[day] = stats;
    this.manifestDirty = true;

    void this.adapter
      .append(LOG_FILE, `${JSON.stringify({ t: now, id: card.id, r: rating, s: before?.sched?.state ?? 0, due: sched.due })}\n`)
      .catch(() => {});
    this.changed();
    return entry;
  }

  /** Revert the most recent review. Returns the card id that was restored. */
  undo(): string | null {
    const last = this.undoStack.pop();
    if (!last) return null;
    if (last.before) this.put(last.id, last.before);
    else this.drop(last.id);
    if (last.dayBefore) this.data.days[last.day] = last.dayBefore;
    else delete this.data.days[last.day];
    this.manifestDirty = true;
    this.changed();
    return last.id;
  }

  /**
   * Move history to a card's new id after it was edited in the app, so it
   * stays the same card instead of relying on `reconcile`'s text matching.
   */
  rekey(migrations: Array<{ from: string; to: string }>, cards: ReviewCard[]): void {
    const moves = migrations.filter(({ from, to }) => from !== to && this.data.cards[from]);
    if (moves.length === 0) return;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const entries = moves.map(({ from }) => this.data.cards[from]);
    for (const { from } of moves) this.drop(from);
    moves.forEach(({ to }, i) => {
      const { orphanedAt: _orphaned, ...entry } = entries[i];
      const card = byId.get(to);
      this.put(to, card ? { ...entry, path: card.source.path, fp: cardFingerprint(card) } : entry);
    });
    const renamed = new Map(moves.map(({ from, to }) => [from, to]));
    for (const undo of this.undoStack) undo.id = renamed.get(undo.id) ?? undo.id;
    this.changed();
  }

  /** The full review state as JSON (for backups). Same shape as the v1 `srs.json`. */
  snapshot(): string {
    return JSON.stringify(this.data);
  }

  /** Forget a card's history so it starts over as new. */
  reset(id: string): void {
    this.drop(id);
    this.changed();
  }

  /**
   * Keep history attached to cards as notes change: migrate edited/moved
   * cards, refresh paths, mark vanished cards and prune long-gone ones.
   * Call only with the complete set of cards in the vault.
   */
  reconcile(cards: ReviewCard[], now: number): void {
    let dirty = false;
    for (const { from, to } of planMigrations(cards, this.data.cards)) {
      const { orphanedAt: _orphaned, ...moved } = this.data.cards[from];
      this.put(to, moved);
      this.drop(from);
      dirty = true;
    }
    const present = new Set<string>();
    for (const card of cards) {
      present.add(card.id);
      const entry = this.data.cards[card.id];
      if (!entry) continue;
      const fp = cardFingerprint(card);
      if (entry.path !== card.source.path || entry.fp !== fp || entry.orphanedAt) {
        const { orphanedAt: _orphaned, ...rest } = entry;
        this.put(card.id, { ...rest, path: card.source.path, fp });
        dirty = true;
      }
    }
    for (const [id, entry] of Object.entries(this.data.cards)) {
      if (present.has(id)) continue;
      if (!entry.orphanedAt) {
        entry.orphanedAt = now;
        this.touch(id);
        dirty = true;
      } else if (now - entry.orphanedAt > ORPHAN_GRACE_MS) {
        this.drop(id);
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  /** Counts of cards due on each of the next `days` study days (index 0 = overdue + today). */
  forecast(cards: ReviewCard[], dayEnd: number, days: number): number[] {
    const counts = new Array<number>(days).fill(0);
    for (const card of cards) {
      const sched = this.data.cards[card.id]?.sched;
      if (!sched || sched.state === 0) continue;
      const index = sched.due <= dayEnd ? 0 : Math.ceil((sched.due - dayEnd) / 86_400_000);
      if (index < days) counts[index] += 1;
    }
    return counts;
  }

  flush(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.persist();
  }

  /** Resolves once every save started so far has finished. */
  whenSaved(): Promise<void> {
    return this.saving;
  }

  /**
   * Read v2 (manifest + shards), else migrate v1. Returns true when the
   * loaded state still has to be written as v2. Throws when storage can't be
   * read, so the caller never overwrites data it didn't see.
   */
  private async readStorage(): Promise<boolean> {
    const manifestText = await this.adapter.read(MANIFEST_FILE);
    if (manifestText !== null) {
      await this.readV2(manifestText);
      return false;
    }

    this.shardCount = SHARD_COUNT;
    const legacyText = await this.adapter.read(LEGACY_FILE);
    if (!legacyText) {
      this.data = emptyFile();
      return false;
    }
    try {
      this.data = coerce(JSON.parse(legacyText));
      this.legacyToRemove = true;
    } catch (error) {
      // Unparseable v1 file: start fresh but leave it on disk for recovery.
      console.error('[srs] could not parse legacy review state; leaving it in place', error);
      this.data = emptyFile();
    }
    // Write every shard (overwriting leftovers from an interrupted migration),
    // then the manifest last: until it exists, the next load migrates again.
    for (let i = 0; i < this.shardCount; i += 1) this.dirtyShards.add(i);
    this.manifestDirty = true;
    return true;
  }

  private async readV2(manifestText: string): Promise<void> {
    const data = emptyFile();
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      // Only the day stats and quiz toggles are lost; rewrite a fresh manifest.
      console.error('[srs] could not parse review manifest', error);
      this.manifestDirty = true;
    }
    coerceGlobals(data, manifest);
    const count = isObject(manifest) ? manifest.shards : undefined;
    this.shardCount = typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= MAX_SHARDS ? count : SHARD_COUNT;

    const texts = await Promise.all(
      Array.from({ length: this.shardCount }, (_, i) =>
        this.adapter.read(shardFile(i)).then(
          (text) => ({ ok: true as const, text }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      ),
    );
    texts.forEach((result, i) => {
      if (!result.ok) {
        console.error(`[srs] could not read ${shardFile(i)}; its cards will not be saved this session`, result.error);
        this.blockedShards.add(i);
        return;
      }
      if (!result.text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch (error) {
        console.error(`[srs] could not parse ${shardFile(i)}`, error);
        return;
      }
      if (!isObject(parsed) || !isObject(parsed.cards)) return;
      Object.assign(data.cards, parsed.cards);
    });
    this.data = data;
  }

  private shard(id: string): number {
    return shardOf(id, this.shardCount);
  }

  private put(id: string, entry: StoredCard): void {
    this.data.cards[id] = entry;
    this.dirtyShards.add(this.shard(id));
  }

  private drop(id: string): void {
    if (!(id in this.data.cards)) return;
    delete this.data.cards[id];
    this.dirtyShards.add(this.shard(id));
  }

  /** Mark a card changed in place. */
  private touch(id: string): void {
    this.dirtyShards.add(this.shard(id));
  }

  private entryFor(card: ReviewCard): StoredCard {
    return { path: card.source.path, kind: card.kind, fp: cardFingerprint(card) };
  }

  private changed(): void {
    this.emit();
    if (!this.loaded) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, SAVE_DELAY_MS);
  }

  private persist(): Promise<void> {
    this.saving = this.saving.then(() => this.writeDirty());
    return this.saving;
  }

  private async writeDirty(): Promise<void> {
    if (this.readOnly) return;
    const cutoff = studyDay(Date.now() - KEEP_DAYS * 86_400_000);
    for (const day of Object.keys(this.data.days)) {
      if (day < cutoff) {
        delete this.data.days[day];
        this.manifestDirty = true;
      }
    }

    // Serialize synchronously so later edits land in the next save.
    const shards = [...this.dirtyShards].filter((i) => !this.blockedShards.has(i));
    this.dirtyShards.clear();
    const writeManifest = this.manifestDirty;
    this.manifestDirty = false;
    if (shards.length === 0 && !writeManifest) return;

    const buckets = new Map<number, SrsFile['cards']>(shards.map((i) => [i, {}]));
    if (buckets.size > 0) {
      for (const [id, entry] of Object.entries(this.data.cards)) {
        const bucket = buckets.get(this.shard(id));
        if (bucket) bucket[id] = entry;
      }
    }
    const shardTexts = shards.map((i) => {
      const file: ShardFile = { version: 2, shard: i, cards: buckets.get(i)! };
      return [i, JSON.stringify(file)] as const;
    });
    const manifest: Manifest = {
      version: 2,
      shards: this.shardCount,
      days: this.data.days,
      quizzes: this.data.quizzes,
      quizSyncAt: this.data.quizSyncAt,
    };
    const manifestText = writeManifest ? JSON.stringify(manifest) : '';

    const failed: number[] = [];
    await Promise.all(
      shardTexts.map(async ([i, text]) => {
        try {
          await this.adapter.write(shardFile(i), text);
        } catch (error) {
          console.error(`[srs] could not save ${shardFile(i)}`, error);
          failed.push(i);
        }
      }),
    );
    if (failed.length > 0) {
      // Retry on the next save; hold the manifest back so it never gets ahead of its shards.
      for (const i of failed) this.dirtyShards.add(i);
      if (writeManifest) this.manifestDirty = true;
      return;
    }
    if (writeManifest) {
      try {
        await this.adapter.write(MANIFEST_FILE, manifestText);
      } catch (error) {
        console.error('[srs] could not save review manifest', error);
        this.manifestDirty = true;
        return;
      }
    }
    if (this.legacyToRemove && this.adapter.remove) {
      try {
        await this.adapter.remove(LEGACY_FILE);
        this.legacyToRemove = false;
      } catch (error) {
        console.error('[srs] could not remove migrated srs.json', error);
      }
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
