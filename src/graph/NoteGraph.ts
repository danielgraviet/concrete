import {
  BacklinksVisitor,
  buildNoteResolver,
  type LinkMaps,
} from '../patterns/visitor/BacklinksVisitor';
import type { NoteInput } from '../patterns/visitor/types';
import { noteTitle } from '../patterns/visitor/types';
import { IndexingVisitor, type TermIndex } from '../patterns/visitor/IndexingVisitor';
import { normalizeNoteKey, resolveWikilink } from './wikilinks';

export type GraphNote = NoteInput;

export type BacklinkHit = {
  path: string;
  title: string;
};

/**
 * Vault link graph: forward links, backlinks, and optional term index.
 */
export class NoteGraph {
  private notes: GraphNote[] = [];
  private links: LinkMaps = {
    forward: new Map(),
    back: new Map(),
    unresolved: new Map(),
  };
  private terms: TermIndex = new Map();
  private titleByPath = new Map<string, string>();

  build(notes: GraphNote[]): this {
    this.notes = notes;
    this.titleByPath.clear();
    for (const note of notes) {
      this.titleByPath.set(note.path, noteTitle(note.path, note.content, note.title));
    }

    const resolveTarget = buildNoteResolver(
      notes.map((n) => ({
        path: n.path,
        content: n.content,
        title: this.titleByPath.get(n.path),
      })),
    );

    const linker = new BacklinksVisitor();
    this.links = linker.indexNotes(notes, (target) => resolveTarget(target));

    const indexer = new IndexingVisitor();
    this.terms = indexer.indexNotes(
      notes.map((n) => ({
        ...n,
        title: this.titleByPath.get(n.path),
      })),
    );

    return this;
  }

  /** Notes that contain a wikilink to `path` (or its title). */
  getBacklinks(pathOrTitle: string): BacklinkHit[] {
    const path = this.resolvePath(pathOrTitle);
    if (!path) return [];
    const sources = this.links.back.get(path) ?? new Set();
    return [...sources].map((p) => ({
      path: p,
      title: this.titleByPath.get(p) ?? noteTitle(p),
    }));
  }

  getOutgoing(pathOrTitle: string): BacklinkHit[] {
    const path = this.resolvePath(pathOrTitle);
    if (!path) return [];
    const targets = this.links.forward.get(path) ?? new Set();
    return [...targets]
      .filter((t) => !t.startsWith('?'))
      .map((p) => ({
        path: p,
        title: this.titleByPath.get(p) ?? noteTitle(p),
      }));
  }

  getUnresolved(pathOrTitle: string): string[] {
    const path = this.resolvePath(pathOrTitle);
    if (!path) return [];
    return [...(this.links.unresolved.get(path) ?? [])];
  }

  getTermIndex(): TermIndex {
    return this.terms;
  }

  getNotes(): GraphNote[] {
    return this.notes;
  }

  resolvePath(pathOrTitle: string): string | null {
    const direct = this.notes.find((n) => n.path === pathOrTitle);
    if (direct) return direct.path;
    return resolveWikilink(
      pathOrTitle,
      this.notes.map((n) => ({
        path: n.path,
        title: this.titleByPath.get(n.path),
      })),
    );
  }

  /** Convenience: case-insensitive path lookup by filename. */
  findByName(name: string): GraphNote | undefined {
    const key = normalizeNoteKey(name);
    return this.notes.find((n) => {
      const base = normalizeNoteKey(n.path.split(/[/\\]/).pop() ?? n.path);
      const title = normalizeNoteKey(this.titleByPath.get(n.path) ?? '');
      return base === key || title === key;
    });
  }
}

/** One-shot backlinks for a selected note. */
export function getBacklinksFor(
  selectedPath: string,
  notes: GraphNote[],
): BacklinkHit[] {
  return new NoteGraph().build(notes).getBacklinks(selectedPath);
}
