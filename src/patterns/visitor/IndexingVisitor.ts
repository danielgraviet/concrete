import type { DocumentVisitor, NoteInput, VisitableNode } from './types';
import { noteTitle } from './types';
import { walkDocument } from './walkMarkdown';

export type TermIndex = Map<string, Set<string>>;

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9'_-]*/g;

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE);
  return matches ?? [];
}

/**
 * Builds an inverted index of terms → note paths.
 * Use via walkDocument / BlockNode.accept, or IndexingVisitor.indexNotes().
 */
export class IndexingVisitor implements DocumentVisitor {
  readonly index: TermIndex = new Map();
  private currentPath = '';

  beginNote(path: string): void {
    this.currentPath = path;
  }

  visit(node: VisitableNode): void {
    if (!this.currentPath) return;
    if (node.kind === 'code' || node.kind === 'thematicBreak' || node.kind === 'document') {
      return;
    }
    const text = node.text;
    if (!text) return;
    for (const term of tokenize(text)) {
      let set = this.index.get(term);
      if (!set) {
        set = new Set();
        this.index.set(term, set);
      }
      set.add(this.currentPath);
    }
  }

  /** Also index the note title / filename. */
  indexTitle(path: string, title: string): void {
    this.currentPath = path;
    for (const term of tokenize(title)) {
      let set = this.index.get(term);
      if (!set) {
        set = new Set();
        this.index.set(term, set);
      }
      set.add(path);
    }
  }

  indexNotes(notes: NoteInput[]): TermIndex {
    this.index.clear();
    for (const note of notes) {
      const title = noteTitle(note.path, note.content, note.title);
      this.indexTitle(note.path, title);
      this.beginNote(note.path);
      walkDocument(note.content, this);
    }
    return this.index;
  }

  lookup(term: string): string[] {
    const set = this.index.get(term.toLowerCase());
    return set ? [...set] : [];
  }

  toObject(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [term, paths] of this.index) {
      out[term] = [...paths];
    }
    return out;
  }
}
