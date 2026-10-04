import { serializeNoteMcq, type ParsedMcqOption } from './parseNoteCards';

/** Append card blocks under a `## Flashcards` heading (created if missing), separated by blank lines. */
export function appendCardLines(markdown: string, blocks: string[]): string {
  const kept = blocks.map((block) => block.replace(/\s+$/, '')).filter(Boolean);
  if (kept.length === 0) return markdown;
  const body = markdown.replace(/\s+$/, '');
  const block = kept.join('\n\n');
  if (/^##\s+Flashcards\s*$/im.test(body)) return `${body}\n\n${block}\n`;
  return `${body}\n\n## Flashcards\n\n${block}\n`;
}

/** Build a Front :: Back line for note insertion. */
export function formatBasicCardLine(front: string, back: string): string {
  return `${front.trim()} :: ${back.trim()}`;
}

/** Build a cloze paragraph for note insertion. */
export function formatClozeCardLine(text: string): string {
  return text.trim();
}

/** Build a `?mcq` block for note insertion. */
export function formatMcqCardBlock(prompt: string, options: ParsedMcqOption[]): string {
  return serializeNoteMcq(prompt, options);
}
