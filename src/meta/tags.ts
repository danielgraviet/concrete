import { parseFrontmatter, splitFrontmatter } from './frontmatter';

/** Inline #tags — word chars, hyphen, underscore, slash for nested tags. */
export const INLINE_TAG_RE = /(?:^|[\s([{])#([A-Za-z][A-Za-z0-9_/-]*)/g;

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

export function tagsFromFrontmatterValue(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map(normalizeTag)
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((v) => (typeof v === 'string' ? tagsFromFrontmatterValue(v) : []))
      .filter(Boolean);
  }
  return [];
}

export function extractInlineTags(body: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(INLINE_TAG_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    tags.push(normalizeTag(m[1]));
  }
  return tags;
}

/**
 * Tags from frontmatter.tags (string or array) AND inline #tags in the body.
 */
export function extractTags(content: string): string[] {
  const { frontmatter, body } = splitFrontmatter(content);
  const fromFm = tagsFromFrontmatterValue(frontmatter.tags);
  const fromBody = extractInlineTags(body);
  return uniqueTags([...fromFm, ...fromBody]);
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Re-export for callers that only need FM tags. */
export function frontmatterTags(content: string): string[] {
  return tagsFromFrontmatterValue(parseFrontmatter(content).tags);
}
