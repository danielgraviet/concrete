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
 * Full import-time math normalization for the editor.
 * Order: wrap bare lines → expand one-line `$$` → fix `\=`.
 */
export function normalizeMathMarkdown(markdown: string): string {
  return sanitizeLatexEquals(
    normalizeDisplayMath(wrapBareMathLines(markdown)),
  );
}
