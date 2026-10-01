/**
 * Card syntax inside ordinary notes:
 *
 *   Question :: Answer                 basic card
 *   Term ::: Definition                basic card + its reverse
 *   The {{mitochondria}} makes ATP.    cloze — each blank is its own card
 *   {{1::a}} … {{1::b}}                numbered blanks are hidden together
 *   {{c1::answer::hint}}               Anki-style group with a hint
 *
 *   Multi-line question               multi-line basic card: front is the
 *   ?                                  paragraph above the `?` line, back is
 *   Answer, may include code/math      what follows until a blank line (a code
 *                                      or math block right after still counts)
 *   (`??` makes the reverse too)
 *
 * Code fences, math blocks, inline code and inline math are never scanned.
 * `::` needs whitespace on both sides so `std::vector` and Dataview `key:: v` are left alone.
 */

export type ParsedNoteCard =
  | { kind: 'basic'; front: string; back: string; line: number }
  | { kind: 'cloze'; text: string; group: string; line: number };

/** Where a parsed card sits in the note and how it was written, for editing it in place. */
export type NoteCardSpan = ParsedNoteCard & {
  /** Line after the card's last line. */
  end: number;
  /** `inline` = `Q :: A`; `block` = the multi-line `?` form; `cloze` = a `{{…}}` paragraph. */
  layout: 'inline' | 'block' | 'cloze';
  /** Written with `:::` / `??`, so the note holds this card and its reverse. */
  paired: boolean;
  /** This is the generated reverse of a paired card. */
  reverse: boolean;
};

export type ClozeBlank = {
  start: number;
  end: number;
  group: string;
  answer: string;
  hint?: string;
};

const FENCE_RE = /^\s*(```+|~~~+)/;
const MATH_FENCE_RE = /^\s*\$\$/;
const PREFIX_RE = /^\s*(?:>\s?)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;
const LIST_ITEM_RE = /^\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s+/;
const HEADING_RE = /^\s*#{1,6}\s+/;
const CLOZE_RE = /\{\{((?:(?!\}\}).)+?)\}\}/g;
const MULTILINE_SEP_RE = /^\s*(\?\??)\s*$/;

/** Same length as `text`, with inline code and inline math blanked out (for detection only). */
export function maskInline(text: string): string {
  return text
    .replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
    .replace(/\$\$[^$]*\$\$|\$[^$\s][^$]*?\$/g, (m) => ' '.repeat(m.length));
}

/** Strip list/heading/quote/checkbox prefixes from a line. */
export function stripLinePrefix(line: string): string {
  return line.replace(PREFIX_RE, '');
}

/** Blanks in cloze text. Unnumbered blanks each get their own group. */
export function parseClozeBlanks(text: string): ClozeBlank[] {
  const masked = maskInline(text);
  const blanks: ClozeBlank[] = [];
  let auto = 0;
  const re = new RegExp(CLOZE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked))) {
    const inner = text.slice(match.index + 2, match.index + match[0].length - 2);
    const parts = inner.split('::');
    let group: string;
    let answer: string;
    let hint: string | undefined;
    if (parts.length >= 2 && /^c?\d+$/i.test(parts[0].trim())) {
      group = parts[0].trim().replace(/^c/i, '');
      answer = parts[1];
      hint = parts.slice(2).join('::') || undefined;
    } else {
      auto += 1;
      group = `#${auto}`;
      answer = parts[0];
      hint = parts.slice(1).join('::') || undefined;
    }
    answer = answer.trim();
    if (!answer) continue;
    blanks.push({ start: match.index, end: match.index + match[0].length, group, answer, hint: hint?.trim() });
  }
  return blanks;
}

type Line = { text: string; code: boolean };

function classifyLines(lines: string[], from: number): Line[] {
  const out: Line[] = [];
  let fence: string | null = null;
  let math = false;
  lines.forEach((text, index) => {
    if (index < from) {
      out.push({ text, code: true });
      return;
    }
    if (fence) {
      out.push({ text, code: true });
      if (text.trim().startsWith(fence)) fence = null;
      return;
    }
    if (math) {
      out.push({ text, code: true });
      if (text.trim().endsWith('$$')) math = false;
      return;
    }
    const open = FENCE_RE.exec(text);
    if (open) {
      fence = open[1];
      out.push({ text, code: true });
      return;
    }
    if (MATH_FENCE_RE.test(text)) {
      const rest = text.trim().slice(2);
      // `$$ x $$` on one line closes itself.
      math = !rest.includes('$$');
      out.push({ text, code: true });
      return;
    }
    out.push({ text, code: false });
  });
  return out;
}

function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

/** Index just past a fenced/math block starting at `start` (which must open one). */
function skipBlock(lines: Line[], start: number): number {
  let i = start + 1;
  while (i < lines.length && lines[i].code) i += 1;
  return i;
}

function splitOn(line: string, masked: string, sep: string): [string, string] | null {
  const re = new RegExp(`(^|\\s)${sep}(\\s|$)`);
  const match = re.exec(masked);
  if (!match) return null;
  const at = match.index + match[1].length;
  return [line.slice(0, at), line.slice(at + sep.length)];
}

export function parseNoteCards(markdown: string): ParsedNoteCard[] {
  return parseNoteCardSpans(markdown).map(({ end: _end, layout: _layout, paired: _paired, reverse: _reverse, ...card }) => card);
}

/** Like `parseNoteCards`, plus each card's line span and syntax. */
export function parseNoteCardSpans(markdown: string): NoteCardSpan[] {
  const raw = markdown.replace(/\r\n?/g, '\n').split('\n');
  const lines = classifyLines(raw, frontmatterEnd(raw));
  const cards: NoteCardSpan[] = [];
  const consumed = new Set<number>();

  // Multi-line `?` cards first so their lines aren't re-read as other cards.
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].code) continue;
    const sep = MULTILINE_SEP_RE.exec(lines[i].text);
    if (!sep) continue;
    let top = i;
    while (top > 0 && !lines[top - 1].code && lines[top - 1].text.trim() && !consumed.has(top - 1)) top -= 1;
    if (top === i) continue;

    let end = i + 1;
    while (end < lines.length && !lines[end].text.trim()) end += 1;
    const backStart = end;
    while (end < lines.length) {
      const line = lines[end];
      if (line.code) {
        end = skipBlock(lines, end);
        continue;
      }
      if (!line.text.trim()) {
        let next = end;
        while (next < lines.length && !lines[next].text.trim()) next += 1;
        // A code or math block right after the answer paragraph is part of the answer.
        if (next < lines.length && lines[next].code) {
          end = skipBlock(lines, next);
          continue;
        }
        break;
      }
      if (HEADING_RE.test(line.text) || MULTILINE_SEP_RE.test(line.text)) break;
      end += 1;
    }

    const front = raw.slice(top, i).map((l, k) => (k === 0 ? stripLinePrefix(l) : l)).join('\n').trim();
    const back = raw.slice(backStart, end).join('\n').trim();
    for (let k = top; k < end; k += 1) consumed.add(k);
    if (!front || !back) continue;
    const paired = sep[1] === '??';
    const span = { line: top, end, layout: 'block' as const, paired };
    cards.push({ kind: 'basic', front, back, ...span, reverse: false });
    if (paired) cards.push({ kind: 'basic', front: back, back: front, ...span, reverse: true });
    i = end - 1;
  }

  // Single-line `::` / `:::` cards.
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].code || consumed.has(i)) continue;
    const text = lines[i].text;
    const masked = maskInline(text);
    const reversed = splitOn(text, masked, ':::');
    const pair = reversed ?? splitOn(text, masked, '::');
    if (!pair) continue;
    const front = stripLinePrefix(pair[0]).trim();
    const back = pair[1].trim();
    if (!front || !back) continue;
    consumed.add(i);
    const span = { line: i, end: i + 1, layout: 'inline' as const, paired: Boolean(reversed) };
    cards.push({ kind: 'basic', front, back, ...span, reverse: false });
    if (reversed) cards.push({ kind: 'basic', front: back, back: front, ...span, reverse: true });
  }

  // Cloze: a paragraph (consecutive plain lines) or a single list item / heading.
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].code || consumed.has(i) || !lines[i].text.trim()) continue;
    let end = i + 1;
    const single = LIST_ITEM_RE.test(lines[i].text) || HEADING_RE.test(lines[i].text);
    if (!single) {
      while (
        end < lines.length &&
        !lines[end].code &&
        !consumed.has(end) &&
        lines[end].text.trim() &&
        !LIST_ITEM_RE.test(lines[end].text) &&
        !HEADING_RE.test(lines[end].text)
      ) {
        end += 1;
      }
    }
    const text = raw
      .slice(i, end)
      .map((l, k) => (k === 0 ? stripLinePrefix(l) : l))
      .join('\n')
      .trim();
    const groups = [...new Set(parseClozeBlanks(text).map((blank) => blank.group))];
    for (const group of groups) {
      cards.push({ kind: 'cloze', text, group, line: i, end, layout: 'cloze', paired: false, reverse: false });
    }
    i = end - 1;
  }

  return cards.sort((a, b) => a.line - b.line);
}

/** Cheap pre-check so notes without any card syntax skip the full parse. */
export function mightContainCards(markdown: string): boolean {
  return markdown.includes('::') || markdown.includes('{{') || /^\s*\?\??\s*$/m.test(markdown);
}

/** Split cloze text into segments for display, hiding the blanks in `group`. */
export function clozeDisplaySegments(
  text: string,
  group: string,
): Array<{ type: 'text'; value: string } | { type: 'blank'; answer: string; hint?: string; hidden: boolean }> {
  const segments: ReturnType<typeof clozeDisplaySegments> = [];
  let last = 0;
  for (const blank of parseClozeBlanks(text)) {
    if (blank.start > last) segments.push({ type: 'text', value: text.slice(last, blank.start) });
    segments.push({ type: 'blank', answer: blank.answer, hint: blank.hint, hidden: blank.group === group });
    last = blank.end;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}
