import { cleanLinkedInput, type LinkedCard, type LinkedCardInput } from './LinkedCards';

export const LINKED_CARDS_FILE = '.vault/cards.json';

type CardsFile = {
  version: 1;
  cards: LinkedCard[];
  /** When `## Flashcards` sections were moved out of notes (once per vault). */
  migratedAt?: number;
};

type Adapter = {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
};

function adapterFor(root: string, name: string): Adapter {
  const api = typeof window !== 'undefined' ? window.vault : undefined;
  if (root && api?.readData && api.writeData) {
    const { readData, writeData } = api;
    return {
      read: () => readData(root, name),
      write: async (content) => {
        await writeData(root, name, content);
      },
    };
  }
  const key = `mv:${name}:${root || '__demo__'}`;
  return {
    read: async () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: async (content) => {
      try {
        localStorage.setItem(key, content);
      } catch {
        // Storage full/unavailable — cards just won't persist in demo mode.
      }
    },
  };
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
  await adapterFor(root, name).write(content);
}

/**
 * Cards made in the app, each linked to a note by path. Writes go straight to
 * disk (in order) so a card is saved before the panel says it was added.
 */
export class LinkedCardStore {
  private data: CardsFile = { version: 1, cards: [] };
  private adapter: Adapter;
  private listeners = new Set<() => void>();
  private loaded = false;
  /** The file exists but couldn't be read: never overwrite it. */
  private unreadable = false;
  private writing: Promise<void> = Promise.resolve();
  version = 0;

  constructor(root: string) {
    this.adapter = adapterFor(root, LINKED_CARDS_FILE);
  }

  async load(): Promise<void> {
    try {
      const text = await this.adapter.read();
      if (text) {
        const raw = JSON.parse(text) as Partial<CardsFile>;
        this.data = {
          version: 1,
          cards: Array.isArray(raw.cards) ? raw.cards.filter(isLinkedCard) : [],
          ...(typeof raw.migratedAt === 'number' ? { migratedAt: raw.migratedAt } : {}),
        };
      }
    } catch (error) {
      console.error('[cards] could not read linked cards', error);
      this.unreadable = true;
    }
    this.loaded = true;
    this.emit();
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
    await this.commit((data) =>
      data.cards.some((card) => moved(card.path) !== card.path || (card.folder ? moved(card.folder) !== card.folder : false))
        ? { ...data, cards: data.cards.map((card) => ({ ...card, path: moved(card.path), ...(card.folder ? { folder: moved(card.folder) } : {}) })) }
        : null,
    );
  }

  /** Persist `change(current)` (null = no change), then make it current. On failure nothing changes. */
  private commit(change: (data: CardsFile) => CardsFile | null): Promise<void> {
    const run = this.writing.then(async () => {
      if (!this.loaded) throw new Error('Cards are still loading. Try again in a moment.');
      if (this.unreadable) throw new Error(`Could not read ${LINKED_CARDS_FILE}, so it was left untouched. Fix or remove it, then reopen the vault.`);
      const next = change(this.data);
      if (!next) return;
      await this.adapter.write(JSON.stringify(next, null, 2));
      this.data = next;
      this.emit();
    });
    this.writing = run.catch(() => {});
    return run;
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
