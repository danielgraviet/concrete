import { stripFrontmatter } from '../patterns/visitor/walkMarkdown';

export type HighlightSegment = { text: string; match: boolean };

const SNIPPET_LENGTH = 140;
const SNIPPET_LEAD = 40;

/** Drop the markdown syntax that reads as noise in a one-line preview. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One-line preview of `line` (0-based, after frontmatter — as reported by
 * SearchIndex), windowed around the first matching term.
 */
export function lineSnippet(content: string, line: number, terms: string[]): string {
  const text = plainLine(stripFrontmatter(content).split(/\r?\n/)[line] ?? '');
  if (text.length <= SNIPPET_LENGTH) return text;

  const lower = text.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const start = hits.length ? Math.max(0, Math.min(...hits) - SNIPPET_LEAD) : 0;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Split `text` into matched / unmatched runs for rendering highlights safely. */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  const needles = [...new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))];
  if (!text || needles.length === 0) return text ? [{ text, match: false }] : [];

  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
      marked.fill(true, i, i + needle.length);
    }
  }

  const segments: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i < text.length && marked[i] === marked[start]) continue;
    segments.push({ text: text.slice(start, i), match: marked[start] });
    start = i;
  }
  return segments;
}
