/**
 * Turn raw per-page PDF text into compact quiz-generation context.
 * Pure functions: extraction itself happens in Electron main.
 */

/** Below this, a page excerpt is too short to ask good questions about. */
const MIN_EXCERPT_CHARS = 600;
/** Header/footer lines must repeat on at least this share of pages to be dropped. */
const REPEAT_SHARE = 0.6;
/** Only the first/last few lines of a page are header/footer candidates. */
const EDGE_LINES = 2;

export const NO_TEXT_ERROR =
  'This PDF has no selectable text (it is probably scanned), so a quiz cannot be made from it.';

const PAGE_NUMBER_LINE = /^(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;

/** Digits vary across pages ("Chapter 2 · 14"), so compare lines with digits masked. */
function lineKey(line: string): string {
  return line.replace(/\d+/g, '#').toLowerCase();
}

/**
 * Drop running headers/footers and page numbers, rejoin words hyphenated
 * across line breaks, and collapse whitespace. Keeps one entry per page.
 */
export function cleanPdfPages(pages: string[]): string[] {
  const split = pages.map((page) =>
    page
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

  const repeated = new Set<string>();
  if (split.length >= 3) {
    const counts = new Map<string, number>();
    for (const lines of split) {
      const edges = new Set([...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)].map(lineKey));
      for (const key of edges) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count / split.length >= REPEAT_SHARE) repeated.add(key);
    }
  }

  return split.map((lines) => {
    const last = lines.length - 1;
    const kept = lines.filter((line, i) => {
      const isEdge = i < EDGE_LINES || i > last - EDGE_LINES;
      return !(isEdge && (repeated.has(lineKey(line)) || PAGE_NUMBER_LINE.test(line)));
    });
    return kept.join('\n').replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2');
  });
}

/**
 * Parse "3-10, 15" into sorted, unique 1-based page numbers.
 * Empty input means every page. Without `totalPages`, only syntax is checked.
 */
export function parsePageRange(input: string, totalPages?: number): number[] {
  const text = input.trim();
  if (!text) {
    return totalPages ? Array.from({ length: totalPages }, (_, i) => i + 1) : [];
  }
  const pages = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error(`Invalid page range "${part.trim()}". Use e.g. 3-10, 15.`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < start) throw new Error(`Invalid page range "${part.trim()}".`);
    if (totalPages && end > totalPages) {
      throw new Error(`Page ${end} is past the end of the PDF (${totalPages} pages).`);
    }
    for (let p = start; p <= end; p += 1) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.8 ? cut.slice(0, space) : cut}…`;
}

/**
 * Fit the selected pages into `budgetChars`. When the text is too long, keep
 * pages evenly spread across the selection (not just the first ones) so the
 * quiz covers the whole range. Each page is tagged `[p. N]`.
 */
export function buildPdfContext(cleanedPages: string[], pageNumbers: number[], budgetChars: number): string {
  const chosen = pageNumbers
    .map((n) => ({ n, text: cleanedPages[n - 1]?.trim() ?? '' }))
    .filter((page) => page.text);
  if (chosen.reduce((sum, page) => sum + page.text.length, 0) < 20) {
    throw new Error(NO_TEXT_ERROR);
  }

  const render = (pages: typeof chosen, limit: number) =>
    pages.map((page) => `[p. ${page.n}]\n${excerpt(page.text, limit)}`).join('\n\n');

  const full = render(chosen, Infinity);
  if (full.length <= budgetChars) return full;

  const fit = Math.max(1, Math.min(chosen.length, Math.floor(budgetChars / MIN_EXCERPT_CHARS)));
  const sampled =
    fit === chosen.length
      ? chosen
      : Array.from({ length: fit }, (_, i) => chosen[Math.floor((i * chosen.length) / fit)]);
  // Leave room for the "[p. N]" tags and separators.
  const perPage = Math.floor(budgetChars / sampled.length) - 16;
  return render(sampled, Math.max(1, perPage));
}
