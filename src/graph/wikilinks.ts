import { parseWikilinks, type WikilinkRef } from '../patterns/visitor/BacklinksVisitor';

export type { WikilinkRef };
export { parseWikilinks };

/** Normalize a wikilink target for comparison (case-insensitive, no .md). */
export function normalizeNoteKey(name: string): string {
  return name.trim().replace(/\.md$/i, '').toLowerCase();
}

/**
 * Resolve [[Note]] / [[Note|alias]] target against known note paths/titles.
 * Matching is case-insensitive and ignores `.md`.
 */
export function resolveWikilink(
  target: string,
  notes: Array<{ path: string; title?: string }>,
): string | null {
  const key = normalizeNoteKey(target);
  for (const note of notes) {
    const base = normalizeNoteKey(note.path.split(/[/\\]/).pop() ?? note.path);
    const title = note.title ? normalizeNoteKey(note.title) : null;
    if (key === base || (title && key === title) || key === normalizeNoteKey(note.path)) {
      return note.path;
    }
  }
  return null;
}

export function extractOutgoingTargets(content: string): WikilinkRef[] {
  return parseWikilinks(content);
}
