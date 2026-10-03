import { CARD_GENERATION_MODEL, ChatModelProvider, type AiClient } from '../ai';
import { truncateNoteContext } from '../ai';
import { parseNoteCards, serializeNoteMcq } from './parseNoteCards';

export type CardStyle = 'mixed' | 'basic' | 'cloze' | 'mcq';

const STYLE_RULES: Record<CardStyle, string> = {
  mixed: 'Mix question/answer cards, cloze cards, and multiple-choice cards, whichever suits each fact.',
  basic: 'Only question/answer cards.',
  cloze: 'Only cloze cards.',
  mcq: 'Only multiple-choice cards.',
};

/** Build the AI prompt from the user's typed concept/draft (primary) plus light note context. */
export function buildCardGenerationPrompt(style: CardStyle, concept: string, existing: string[]): string {
  const draft = concept.trim();
  return [
    'Turn the user draft below into spaced-repetition flashcards.',
    'The draft is the source of truth — expand and clean it into cards. Do not invent unrelated topics.',
    'Use the note context only as background when a fact in the draft needs clarification.',
    '',
    'USER DRAFT:',
    '"""',
    draft,
    '"""',
    '',
    'Format — nothing else (no numbering, no headings, no commentary):',
    '- Question/answer card: one line `Question :: Answer`',
    '- Cloze card: a sentence with the hidden part in double braces, e.g. `The {{mitochondria}} produces ATP.`',
    '- Multiple-choice card: a `?mcq` block, then the prompt, then options with `- [ ]` / `- [x]` (mark exactly one correct unless several are truly correct), then a blank line:',
    '  ?mcq',
    '  Prompt text',
    '  - [ ] Wrong',
    '  - [x] Right',
    '',
    'Rules:',
    '- Each card tests exactly one fact or idea (minimum information principle).',
    '- Questions must make sense on their own, without the note.',
    '- Answers are short: a word, phrase or one sentence.',
    '- Prefer 3–10 cards grounded in the draft.',
    '- Inline code in backticks and math in $…$ are fine. Never put `::` inside code.',
    `- ${STYLE_RULES[style]}`,
    ...(existing.length
      ? ['', 'The note already has these cards — do not repeat them:', ...existing.map((line) => `- ${line}`)]
      : []),
  ].join('\n');
}

/**
 * Run Create Cards AI on OpenRouter Qwen Flash (cheap/fast).
 * Falls back to the app's current provider when the live AI bridge is unavailable (tests / demo).
 */
export async function completeCardGeneration(
  client: AiClient,
  request: { prompt: string; context?: string },
): Promise<string> {
  const context = request.context ? truncateNoteContext(request.context, 2500) : undefined;
  const payload = { prompt: request.prompt, context };
  if (typeof window !== 'undefined' && window.ai?.chatCompletions) {
    const flash = new ChatModelProvider('openrouter', CARD_GENERATION_MODEL);
    return flash.complete(payload);
  }
  return client.getProvider().complete(payload);
}

/** Keep model output chunks that parse as one or more note cards. */
export function cardBlocksFromModel(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const blocks: string[] = [];
  const lines = normalized.split('\n');
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length) break;

    if (/^\s*\?mcq\s*$/i.test(lines[i])) {
      const start = i;
      i += 1;
      while (i < lines.length && lines[i].trim()) i += 1;
      const block = lines.slice(start, i).join('\n').trim();
      if (block && parseNoteCards(block).some((card) => card.kind === 'mcq')) blocks.push(block);
      continue;
    }

    const line = lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^`(.*)`$/, '$1').trim();
    i += 1;
    if (line && parseNoteCards(line).length > 0) blocks.push(line);
  }
  return blocks;
}

/** Summarize existing note cards for the “do not repeat” prompt. */
export function existingCardSummaries(markdown: string): string[] {
  return parseNoteCards(markdown).map((card) => {
    if (card.kind === 'basic') return `${card.front} :: ${card.back}`;
    if (card.kind === 'cloze') return card.text;
    return serializeNoteMcq(card.prompt, card.options).replace(/\n/g, ' / ');
  });
}
