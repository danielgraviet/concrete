/**
 * KaTeX `\=` is a spacing/accent command, not equals. Notes often write it
 * by mistake; treat it as `=`.
 */
export function sanitizeLatexEquals(markdown: string): string {
  return markdown.replace(/\\=/g, '=');
}

/**
 * Normalize one-line `$$...$$` into multi-line display math so remark/micromark
 * treat it as a flow `math` node (own line) instead of inline.
 */
export function normalizeDisplayMath(markdown: string): string {
  return markdown.replace(
    /^([ \t]*)\$\$([^\n]+?)\$\$([ \t]*)$/gm,
    (_match, indent: string, body: string, trail: string) =>
      `${indent}$$\n${body.trim()}\n$$${trail}`,
  );
}

/**
 * Prefer one-line `$$...$$` when the formula itself has no newlines —
 * matches the author's preferred display style.
 */
export function preferOneLineDisplayMath(markdown: string): string {
  return markdown.replace(
    /^([ \t]*)\$\$\r?\n([^\n]+?)\r?\n\$\$([ \t]*)$/gm,
    (_match, indent: string, body: string, trail: string) =>
      `${indent}$$${body.trim()}$$${trail}`,
  );
}

/**
 * True when a whole line is a bare TeX formula (no `$`/`$$` yet).
 * Skips prose that merely mentions a backslash (e.g. "α \= 0.05" mid-sentence).
 */
export function isBareMathLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.includes('$')) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)/.test(t)) return false;
  if (!/\\/.test(t)) return false;

  // Strip text-mode groups so English inside \text{...} does not count as prose.
  let s = t.replace(
    /\\(text|mathrm|mathbf|mathit|textrm|textsf|textbf|textit)\{[^{}]*\}/g,
    ' ',
  );
  s = s.replace(/\\[a-zA-Z]+\*?/g, ' ');
  s = s.replace(/\\./g, ' ');
  s = s.replace(
    /[\d\s+\-*/=<>()[\]{}.,|\\^_~'":;!?α-ωΑ-Ω≈≤≥≠±·×÷∞∫∑∏√∂∇′″‴]+/gu,
    ' ',
  );
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.some((w) => w.length > 3)) return false;

  return /\\[a-zA-Z]+/.test(t) || /\\=/.test(t);
}

/** Wrap whole-line bare TeX in `$$...$$` (outside fenced code). */
export function wrapBareMathLines(markdown: string): string {
  let inCode = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        return line;
      }
      if (inCode || !isBareMathLine(line)) return line;
      const indent = line.match(/^([ \t]*)/)?.[1] ?? '';
      return `${indent}$$${line.trim()}$$`;
    })
    .join('\n');
}

/**
 * Convert LaTeX display math delimiters `\[...\]` to `$$...$$`.
 * Handles multi-line expressions and preserves formatting.
 */
export function normalizeLatexDisplayMath(markdown: string): string {
  return markdown.replace(/\\\[([\s\S]*?)\\\]/g, (match, body) => {
    const trimmed = body.trim();
    if (trimmed.includes('\n')) {
      return `$$\n${trimmed}\n$$`;
    }
    return `$$${trimmed}$$`;
  });
}

/**
 * Convert LaTeX inline math delimiters `\(...\)` to `$...$`.
 * Only converts single-line expressions to avoid breaking paragraph flow.
 */
export function normalizeLatexInlineMath(markdown: string): string {
  return markdown.replace(/\\\(([^\n]*?)\\\)/g, (match, body) => {
    return `$${body.trim()}$`;
  });
}

/** Indexes of single `$` on one line, skipping inline code, `\$` and `$$…$$`. */
function singleDollarIndexes(line: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '`') {
      const run = /^`+/.exec(line.slice(i))![0];
      const close = line.indexOf(run, i + run.length);
      i = close === -1 ? i + run.length : close + run.length;
    } else if (ch === '$' && line[i + 1] === '$') {
      const close = line.indexOf('$$', i + 2);
      i = close === -1 ? i + 2 : close + 2;
    } else {
      if (ch === '$') out.push(i);
      i += 1;
    }
  }
  return out;
}

/**
 * Escape `$` that can't be inline math, so prices like "+$53k to +$23.5k" stay
 * text instead of becoming one formula. Pandoc's rule: an opening `$` is followed
 * by non-space, and the next `$` closes it only if it follows non-space and isn't
 * followed by a digit. Code blocks and `$$` display blocks are left alone.
 */
export function escapeCurrencyDollars(markdown: string): string {
  let fence: string | null = null;
  let display = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (fence) {
        if (line.trim().startsWith(fence)) fence = null;
        return line;
      }
      const open = /^\s*(```+|~~~+)/.exec(line);
      if (open) {
        fence = open[1];
        return line;
      }
      if (display) {
        if (line.includes('$$')) display = false;
        return line;
      }
      if (/^\s*\$\$/.test(line)) {
        display = !line.trim().slice(2).includes('$$');
        return line;
      }
      const dollars = singleDollarIndexes(line);
      const escaped = new Set<number>();
      for (let k = 0; k < dollars.length; k += 1) {
        const start = dollars[k];
        const end = dollars[k + 1];
        const opens = /\S/.test(line[start + 1] ?? '');
        const closes = end !== undefined && /\S/.test(line[end - 1]) && !/\d/.test(line[end + 1] ?? '');
        if (opens && closes) k += 1;
        else escaped.add(start);
      }
      if (!escaped.size) return line;
      return line.split('').map((ch, idx) => (escaped.has(idx) ? `\\${ch}` : ch)).join('');
    })
    .join('\n');
}

/**
 * Full import-time math normalization for the editor.
 * Order: LaTeX delimiters → wrap bare lines → expand one-line `$$` → fix `\=`.
 */
export function normalizeMathMarkdown(markdown: string): string {
  return sanitizeLatexEquals(
    normalizeDisplayMath(
      wrapBareMathLines(normalizeLatexInlineMath(normalizeLatexDisplayMath(markdown)))
    ),
  );
}

/**
 * ChatGPT can put Markdown escapes around inline math delimiters and TeX
 * subscripts (for example `\\$b\\_0\\$`). Those escapes are useful in prose,
 * but prevent the math parser from recognizing/rendering the pasted formula.
 */
export function normalizePastedMathMarkdown(markdown: string): string {
  // ChatGPT's rich/plain clipboard conversion can serialize each line of a
  // display equation as a separate math node. Four adjacent dollars are the
  // closing delimiter of one node followed by the opening delimiter of the
  // next, so remove that seam before the normal delimiter pass.
  const joinedMathFragments = markdown.replace(/\$\$\$\$/g, '');
  const unescapedInlineMath = joinedMathFragments.replace(
    /\\\$([^\n]*?)\\\$/g,
    (_match, body: string) => `$${body.trim().replace(/\\_/g, '_')}$`,
  );
  return normalizeMathMarkdown(unescapedInlineMath);
}
