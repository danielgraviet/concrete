import { isQuizPath } from '../quiz/paths';
import { isHiddenVaultFile } from '../vault/fileTree';
import { draftsFromLinkedCards, draftsFromNote, draftsFromQuiz, withIds } from './buildCards';
import type { LinkedCard } from './LinkedCards';
import type { CardDraft, ReviewCard } from './types';

export type NoteCards = {
  cards: ReviewCard[];
  /** Quiz source text, kept so quiz attempts can be mapped back to cards. */
  quizMarkdown?: string;
};

type Parsed = { drafts: CardDraft[]; quizMarkdown?: string };

/**
 * Every card in the vault, grouped by note: cards written in the note plus
 * cards linked to it from `.vault/cards.json`. Holds parsed cards only (not
 * note bodies), so it stays small no matter how large the vault is.
 */
export class CardIndex {
  private notes = new Map<string, NoteCards>();
  private parsed = new Map<string, Parsed>();
  private linked = new Map<string, CardDraft[]>();
  private listeners = new Set<() => void>();
  private cached: ReviewCard[] | null = null;
  /** True once every note in the vault has been read at least once. */
  complete = false;
  version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Replace the whole index (vault opened / file list changed). */
  replaceAll(entries: Array<readonly [string, string]>): void {
    this.parsed.clear();
    for (const [path, content] of entries) this.ingest(path, content);
    this.rebuildAll();
    this.complete = true;
    this.emit();
  }

  /** Update one note. Returns true when its cards changed. */
  update(path: string, content: string): boolean {
    const before = this.notes.get(path);
    this.ingest(path, content);
    this.rebuild(path);
    const after = this.notes.get(path);
    const key = (entry?: NoteCards) =>
      entry ? entry.cards.map((c) => `${c.id}@${c.source.line}`).join(',') : '';
    if (key(before) === key(after) && before?.quizMarkdown === after?.quizMarkdown) return false;
    this.emit();
    return true;
  }

  remove(path: string): void {
    if (!this.parsed.delete(path)) return;
    this.rebuild(path);
    this.emit();
  }

  /** Replace every linked card (`.vault/cards.json` changed). */
  setLinked(cards: LinkedCard[]): void {
    const paths = new Set(this.linked.keys());
    this.linked.clear();
    for (const draft of draftsFromLinkedCards(cards)) {
      const list = this.linked.get(draft.source.path);
      if (list) list.push(draft);
      else this.linked.set(draft.source.path, [draft]);
      paths.add(draft.source.path);
    }
    for (const path of paths) this.rebuild(path);
    this.emit();
  }

  /** Drop notes no longer in the vault's file list. */
  retain(paths: string[]): void {
    const keep = new Set(paths);
    let changed = false;
    for (const path of [...this.parsed.keys()]) {
      if (!keep.has(path)) {
        this.parsed.delete(path);
        this.rebuild(path);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  note(path: string): NoteCards | undefined {
    return this.notes.get(path);
  }

  /** All cards, ordered by note path then position; ids unique across the vault. */
  all(): ReviewCard[] {
    if (this.cached) return this.cached;
    const seen = new Set<string>();
    const out: ReviewCard[] = [];
    for (const path of [...this.notes.keys()].sort()) {
      for (const card of this.notes.get(path)!.cards) {
        // The same card text in two notes: first note (by path) keeps the bare id.
        let id = card.id;
        for (let n = 2; seen.has(id); n += 1) id = `${card.id}@${n}`;
        seen.add(id);
        out.push(id === card.id ? card : { ...card, id });
      }
    }
    for (const drafts of this.linked.values()) {
      // Standalone cards use an empty path and live outside the note index.
      // Cards at non-empty paths have already been included above.
      for (const card of withIds(drafts.filter((draft) => !draft.source.path))) {
        let id = card.id;
        for (let n = 2; seen.has(id); n += 1) id = `${card.id}@${n}`;
        seen.add(id);
        out.push(id === card.id ? card : { ...card, id });
      }
    }
    this.cached = out;
    return out;
  }

  private ingest(path: string, content: string): void {
    if (isHiddenVaultFile(path) || !/\.md$/i.test(path)) {
      this.parsed.delete(path);
      return;
    }
    const quiz = isQuizPath(path);
    const drafts = quiz ? draftsFromQuiz(path, content) : draftsFromNote(path, content);
    if (drafts.length === 0) {
      this.parsed.delete(path);
      return;
    }
    this.parsed.set(path, { drafts, ...(quiz ? { quizMarkdown: content } : {}) });
  }

  /** Note cards first, then linked ones, so linked cards never shift a note card's id. */
  private rebuild(path: string): void {
    if (!path) return;
    const parsed = this.parsed.get(path);
    const drafts = [...(parsed?.drafts ?? []), ...(this.linked.get(path) ?? [])];
    if (drafts.length === 0) {
      this.notes.delete(path);
      return;
    }
    this.notes.set(path, { cards: withIds(drafts), ...(parsed?.quizMarkdown !== undefined ? { quizMarkdown: parsed.quizMarkdown } : {}) });
  }

  private rebuildAll(): void {
    this.notes.clear();
    for (const path of new Set([...this.parsed.keys(), ...this.linked.keys()])) this.rebuild(path);
  }

  private emit(): void {
    this.cached = null;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
