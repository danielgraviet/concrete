import type { DocumentVisitor, NoteInput, VisitableNode } from './types';
import { noteTitle } from './types';
import { walkDocument } from './walkMarkdown';

/** Parsed [[target]] or [[target|alias]] occurrence. */
export type WikilinkRef = {
  target: string;
  alias?: string;
  raw: string;
};

/** Matches [[Note]], [[Note|alias]], and optional [[Note#heading|alias]]. */
export const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export function parseWikilinks(text: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const target = m[1].trim();
    const alias = m[2]?.trim();
    if (!target) continue;
    refs.push({
      target,
      ...(alias ? { alias } : {}),
      raw: m[0],
    });
  }
  return refs;
}

export type LinkMaps = {
  /** path → resolved target paths (or unresolved target strings prefixed with ?) */
  forward: Map<string, Set<string>>;
  /** target path → source paths that link to it */
  back: Map<string, Set<string>>;
  /** unresolved [[targets]] by source path */
  unresolved: Map<string, Set<string>>;
};

/**
 * Extracts [[wikilinks]] while walking a document and accumulates link maps.
 */
export class BacklinksVisitor implements DocumentVisitor {
  readonly forward: Map<string, Set<string>> = new Map();
  readonly back: Map<string, Set<string>> = new Map();
  readonly unresolved: Map<string, Set<string>> = new Map();

  private currentPath = '';
  private resolve: (target: string) => string | null = () => null;
  private collected: WikilinkRef[] = [];

  beginNote(path: string, resolve: (target: string) => string | null): void {
    this.currentPath = path;
    this.resolve = resolve;
    this.collected = [];
    if (!this.forward.has(path)) this.forward.set(path, new Set());
  }

  visit(node: VisitableNode): void {
    if (!node.text) return;
    for (const ref of parseWikilinks(node.text)) {
      this.collected.push(ref);
      this.recordLink(ref.target);
    }
  }

  /** Scan raw markdown (including parts not in block text). */
  scanRaw(content: string): void {
    for (const ref of parseWikilinks(content)) {
      this.collected.push(ref);
      this.recordLink(ref.target);
    }
  }

  private recordLink(target: string): void {
    const resolved = this.resolve(target);
    const forward = this.forward.get(this.currentPath) ?? new Set();
    this.forward.set(this.currentPath, forward);

    if (resolved) {
      forward.add(resolved);
      let back = this.back.get(resolved);
      if (!back) {
        back = new Set();
        this.back.set(resolved, back);
      }
      back.add(this.currentPath);
    } else {
      forward.add(`?${target}`);
      let unresolved = this.unresolved.get(this.currentPath);
      if (!unresolved) {
        unresolved = new Set();
        this.unresolved.set(this.currentPath, unresolved);
      }
      unresolved.add(target);
    }
  }

  getCollected(): WikilinkRef[] {
    return [...this.collected];
  }

  indexNotes(
    notes: NoteInput[],
    resolve: (target: string, fromPath: string) => string | null,
  ): LinkMaps {
    this.forward.clear();
    this.back.clear();
    this.unresolved.clear();

    for (const note of notes) {
      this.beginNote(note.path, (t) => resolve(t, note.path));
      // Full-text scan catches every [[wikilink]]; Sets dedupe if also walked via AST.
      this.scanRaw(note.content);
    }

    return {
      forward: this.forward,
      back: this.back,
      unresolved: this.unresolved,
    };
  }

  /** Walk a BlockNode / markdown AST for the current note (Composite path). */
  walk(source: string | VisitableNode): void {
    walkDocument(source, this);
  }

  getBacklinks(path: string): string[] {
    return [...(this.back.get(path) ?? [])];
  }

  getOutgoing(path: string): string[] {
    return [...(this.forward.get(path) ?? [])];
  }
}

/** Build a case-insensitive title/filename → path resolver for a note set. */
export function buildNoteResolver(notes: NoteInput[]): (target: string) => string | null {
  const map = new Map<string, string>();
  for (const note of notes) {
    const title = noteTitle(note.path, note.content, note.title);
    const base = (note.path.split(/[/\\]/).pop() ?? note.path).replace(/\.md$/i, '');
    map.set(title.toLowerCase(), note.path);
    map.set(base.toLowerCase(), note.path);
    map.set(note.path.toLowerCase(), note.path);
    map.set(`${base.toLowerCase()}.md`, note.path);
  }
  return (target: string) => {
    const key = target.trim().replace(/\.md$/i, '').toLowerCase();
    return (
      map.get(key) ??
      map.get(`${key}.md`) ??
      map.get(target.trim().toLowerCase()) ??
      null
    );
  };
}
