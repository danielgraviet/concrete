/** Append card lines under a `## Flashcards` heading (created if missing), one paragraph each. */
export function appendCardLines(markdown: string, lines: string[]): string {
  const body = markdown.replace(/\s+$/, '');
  const block = lines.join('\n\n');
  if (/^##\s+Flashcards\s*$/im.test(body)) return `${body}\n\n${block}\n`;
  return `${body}\n\n## Flashcards\n\n${block}\n`;
}
