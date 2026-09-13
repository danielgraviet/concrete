import type { CardsFile, CreateCardInput, Flashcard, SrsState } from './types';
import { createCardFromSelection as buildCard } from './createCardFromSelection';

const STORAGE_PREFIX = 'mv:cards:';

/** Optional vault-file persistence; Electron can wire this later. */
export interface FileAdapter {
  read(vaultRoot: string): Promise<CardsFile | null>;
  write(vaultRoot: string, data: CardsFile): Promise<void>;
}

function storageKey(vaultRoot: string): string {
  return `${STORAGE_PREFIX}${vaultRoot || '__demo__'}`;
}

function emptyFile(): CardsFile {
  return { version: 1, cards: [] };
}

/**
 * CardStore — localStorage keyed by vault root (MVP), with optional FileAdapter.
 */
export class CardStore {
  private vaultRoot: string;
  private cards: Flashcard[] = [];
  private adapter: FileAdapter | null;
  private listeners = new Set<() => void>();

  constructor(vaultRoot: string = '', adapter: FileAdapter | null = null) {
    this.vaultRoot = vaultRoot;
    this.adapter = adapter;
  }

  setVaultRoot(root: string): void {
    this.vaultRoot = root;
  }

  setAdapter(adapter: FileAdapter | null): void {
    this.adapter = adapter;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  getAll(): Flashcard[] {
    return [...this.cards];
  }

  getById(id: string): Flashcard | undefined {
    return this.cards.find((c) => c.id === id);
  }

  async load(): Promise<Flashcard[]> {
    if (this.adapter) {
      try {
        const file = await this.adapter.read(this.vaultRoot);
        if (file?.cards) {
          this.cards = file.cards;
          this.persistLocal();
          this.notify();
          return this.getAll();
        }
      } catch {
        // fall through to localStorage
      }
    }

    try {
      const raw = localStorage.getItem(storageKey(this.vaultRoot));
      if (raw) {
        const parsed = JSON.parse(raw) as CardsFile;
        this.cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      } else {
        this.cards = [];
      }
    } catch {
      this.cards = [];
    }
    this.notify();
    return this.getAll();
  }

  async save(): Promise<void> {
    this.persistLocal();
    if (this.adapter) {
      await this.adapter.write(this.vaultRoot, { version: 1, cards: this.cards });
    }
    this.notify();
  }

  private persistLocal(): void {
    const data: CardsFile = { version: 1, cards: this.cards };
    localStorage.setItem(storageKey(this.vaultRoot), JSON.stringify(data));
  }

  createCardFromSelection(input: CreateCardInput, now: number = Date.now()): Flashcard {
    const card = buildCard(input, now);
    this.cards.push(card);
    void this.save();
    return card;
  }

  updateScheduling(cardId: string, scheduling: SrsState): Flashcard | undefined {
    const index = this.cards.findIndex((c) => c.id === cardId);
    if (index < 0) return undefined;
    const updated = { ...this.cards[index], scheduling };
    this.cards[index] = updated;
    void this.save();
    return updated;
  }

  remove(cardId: string): boolean {
    const before = this.cards.length;
    this.cards = this.cards.filter((c) => c.id !== cardId);
    if (this.cards.length !== before) {
      void this.save();
      return true;
    }
    return false;
  }

  /** Replace all cards (e.g. after import). */
  replaceAll(cards: Flashcard[]): void {
    this.cards = [...cards];
    void this.save();
  }

  static emptyFile = emptyFile;
}
