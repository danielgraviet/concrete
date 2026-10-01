import { cardFingerprint } from './cardId';
import { planMigrations } from './reconcile';
import { newSched, type Scheduler } from './scheduler';
import { studyDay } from './studyDay';
import type { DayStats, Rating, ReviewCard, SrsFile, StoredCard } from './types';

const STATE_FILE = '.vault/srs.json';
const LOG_FILE = '.vault/srs-log.jsonl';
const SAVE_DELAY_MS = 400;
const ORPHAN_GRACE_MS = 30 * 24 * 3600_000;
const KEEP_DAYS = 400;

function emptyFile(): SrsFile {
  return { version: 1, cards: {}, days: {}, quizzes: {}, quizSyncAt: 0 };
}

function coerce(raw: unknown): SrsFile {
  const file = emptyFile();
  if (!raw || typeof raw !== 'object') return file;
  const value = raw as Partial<SrsFile>;
  if (value.cards && typeof value.cards === 'object') file.cards = value.cards;
  if (value.days && typeof value.days === 'object') file.days = value.days;
  if (value.quizzes && typeof value.quizzes === 'object') file.quizzes = value.quizzes;
  if (typeof value.quizSyncAt === 'number') file.quizSyncAt = value.quizSyncAt;
  return file;
}

type Undo = { id: string; before: StoredCard | undefined; day: string; dayBefore: DayStats | undefined };

/** Disk access for `.vault/` data; falls back to localStorage (demo mode, older Electron). */
type DataAdapter = {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
  append(line: string): Promise<void>;
};

function adapterFor(root: string): DataAdapter {
  const api = typeof window !== 'undefined' ? window.vault : undefined;
  if (root && api?.readData && api.writeData && api.appendData) {
    const { readData, writeData, appendData } = api;
    return {
      read: () => readData(root, STATE_FILE),
      write: async (content) => {
        await writeData(root, STATE_FILE, content);
      },
      append: async (line) => {
        await appendData(root, LOG_FILE, line);
      },
    };
  }
  const key = `mv:srs:${root || '__demo__'}`;
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
        // Storage full/unavailable — review state just won't persist.
      }
    },
    append: async () => {},
  };
}

/**
 * Review history for every card, keyed by card id. Card *content* is never
 * stored here — it lives in the notes — only scheduling plus enough text to
 * re-attach history when a card is edited or moved.
 */
export class ReviewStateStore {
  private data: SrsFile = emptyFile();
  private adapter: DataAdapter;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: Undo[] = [];
  private loaded = false;
  version = 0;

  constructor(private root: string) {
    this.adapter = adapterFor(root);
  }

  async load(): Promise<void> {
    try {
      const text = await this.adapter.read();
      this.data = text ? coerce(JSON.parse(text)) : emptyFile();
    } catch {
      this.data = emptyFile();
    }
    this.loaded = true;
    this.emit();
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
    this.changed();
  }

  /** Put quiz questions into review, due now, ahead of other new cards. */
  enroll(cards: ReviewCard[], now: number, syncAt?: number): void {
    for (const card of cards) {
      const existing = this.data.cards[card.id];
      if (existing?.sched && existing.sched.state !== 0) {
        // Already being reviewed — a missed quiz question should come back soon.
        if (existing.sched.due > now) existing.sched = { ...existing.sched, due: now };
        continue;
      }
      this.data.cards[card.id] = {
        ...this.entryFor(card),
        sched: { ...newSched(now), due: now },
        enrolled: true,
      };
    }
    if (syncAt !== undefined) this.data.quizSyncAt = Math.max(this.data.quizSyncAt, syncAt);
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
    this.data.cards[card.id] = entry;

    const stats = { ...(dayBefore ?? { newSeen: 0, reviews: 0, again: 0 }) };
    stats.reviews += 1;
    if (wasNew) stats.newSeen += 1;
    if (rating === 'again') stats.again += 1;
    this.data.days[day] = stats;

    void this.adapter
      .append(`${JSON.stringify({ t: now, id: card.id, r: rating, s: before?.sched?.state ?? 0, due: sched.due })}\n`)
      .catch(() => {});
    this.changed();
    return entry;
  }

  /** Revert the most recent review. Returns the card id that was restored. */
  undo(): string | null {
    const last = this.undoStack.pop();
    if (!last) return null;
    if (last.before) this.data.cards[last.id] = last.before;
    else delete this.data.cards[last.id];
    if (last.dayBefore) this.data.days[last.day] = last.dayBefore;
    else delete this.data.days[last.day];
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
    for (const { from } of moves) delete this.data.cards[from];
    moves.forEach(({ to }, i) => {
      const { orphanedAt: _orphaned, ...entry } = entries[i];
      const card = byId.get(to);
      this.data.cards[to] = card ? { ...entry, path: card.source.path, fp: cardFingerprint(card) } : entry;
    });
    const renamed = new Map(moves.map(({ from, to }) => [from, to]));
    for (const undo of this.undoStack) undo.id = renamed.get(undo.id) ?? undo.id;
    this.changed();
  }

  /** Forget a card's history so it starts over as new. */
  reset(id: string): void {
    delete this.data.cards[id];
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
      this.data.cards[to] = moved;
      delete this.data.cards[from];
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
        this.data.cards[card.id] = { ...rest, path: card.source.path, fp };
        dirty = true;
      }
    }
    for (const [id, entry] of Object.entries(this.data.cards)) {
      if (present.has(id)) continue;
      if (!entry.orphanedAt) {
        entry.orphanedAt = now;
        dirty = true;
      } else if (now - entry.orphanedAt > ORPHAN_GRACE_MS) {
        delete this.data.cards[id];
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

  private async persist(): Promise<void> {
    const cutoff = studyDay(Date.now() - KEEP_DAYS * 86_400_000);
    for (const day of Object.keys(this.data.days)) {
      if (day < cutoff) delete this.data.days[day];
    }
    try {
      await this.adapter.write(JSON.stringify(this.data));
    } catch (error) {
      console.error('[srs] could not save review state', error);
    }
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
