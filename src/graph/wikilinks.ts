/** A parsed `[[target]]` or `[[target|alias]]` occurrence. */
export type WikilinkRef = {
  target: string;
  alias?: string;
  raw: string;
};

/** Matches `[[Note]]`, `[[Note|alias]]`, and optional heading fragments. */
export const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

export function parseWikilinks(text: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  const re = new RegExp(WIKILINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const target = match[1].trim();
    const alias = match[2]?.trim();
    if (!target) continue;
    refs.push({ target, ...(alias ? { alias } : {}), raw: match[0] });
  }
  return refs;
}

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
