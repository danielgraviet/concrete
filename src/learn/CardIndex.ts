import { extractTags } from '../meta/tags';
import { isQuizPath } from '../quiz/paths';
import { isHiddenVaultFile } from '../vault/fileTree';
import { cardsFromNote, cardsFromQuiz } from './buildCards';
import type { ReviewCard } from './types';

export type NoteCards = {
  cards: ReviewCard[];
  tags: string[];
  /** Quiz source text, kept so quiz attempts can be mapped back to cards. */
  quizMarkdown?: string;
};

/**
 * Every card in the vault, grouped by note. Holds parsed cards only (not note
 * bodies), so it stays small no matter how large the vault is.
 */
export class CardIndex {
  private notes = new Map<string, NoteCards>();
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
    this.notes.clear();
    for (const [path, content] of entries) this.ingest(path, content);
    this.complete = true;
    this.emit();
  }

  /** Update one note. Returns true when its cards changed. */
  update(path: string, content: string): boolean {
    const before = this.notes.get(path);
    this.ingest(path, content);
    const after = this.notes.get(path);
    const key = (entry?: NoteCards) =>
      entry ? `${entry.tags.join(',')}|${entry.cards.map((c) => `${c.id}@${c.source.line}`).join(',')}` : '';
    if (key(before) === key(after) && before?.quizMarkdown === after?.quizMarkdown) return false;
    this.emit();
    return true;
  }

  remove(path: string): void {
    if (this.notes.delete(path)) this.emit();
  }

  /** Drop notes no longer in the vault's file list. */
  retain(paths: string[]): void {
    const keep = new Set(paths);
    let changed = false;
    for (const path of [...this.notes.keys()]) {
      if (!keep.has(path)) {
        this.notes.delete(path);
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
    this.cached = out;
    return out;
  }

  tagsFor(path: string): string[] {
    return this.notes.get(path)?.tags ?? [];
  }

  private ingest(path: string, content: string): void {
    if (isHiddenVaultFile(path) || !/\.md$/i.test(path)) {
      this.notes.delete(path);
      return;
    }
    const quiz = isQuizPath(path);
    const cards = quiz ? cardsFromQuiz(path, content) : cardsFromNote(path, content);
    if (cards.length === 0) {
      this.notes.delete(path);
      return;
    }
    this.notes.set(path, {
      cards,
      tags: extractTags(content),
      ...(quiz ? { quizMarkdown: content } : {}),
    });
  }

  private emit(): void {
    this.cached = null;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
