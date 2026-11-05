/** Message/note lines in a sequence diagram: `A->>B: text`, `Note over A: text`. */
const SEQUENCE_TEXT_LINE = /^(\s*(?:[^:\n]*?(?:<<)?[-.]*[-=]+(?:>>|>|x|\)|-)[+-]?[^:\n]*|note\s+(?:left of|right of|over)\s+[^:\n]+)):(.*)$/i;

/**
 * Patch source that GitHub-style Markdown authors write but mermaid rejects.
 *
 * In sequence diagrams `;` is a statement separator, so prose like
 * `Runner->>Runner: Check capacity; prepare storage` fails to parse. Escape
 * semicolons in message text as `#59;` (rendered as `;`), leaving existing
 * entity codes like `#59;` / `#quot;` alone.
 */
export function normalizeMermaid(code: string): string {
  if (!/^\s*sequenceDiagram\b/m.test(code)) return code;
  return code
    .split('\n')
    .map((line) => {
      const match = SEQUENCE_TEXT_LINE.exec(line);
      if (!match) return line;
      const text = match[2].replace(/(?<!#\w+);/g, '#59;');
      return `${match[1]}:${text}`;
    })
    .join('\n');
}
