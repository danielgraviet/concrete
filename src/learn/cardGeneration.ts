import { CARD_GENERATION_MODEL, ChatModelProvider, type AiClient } from '../ai';
import { truncateNoteContext } from '../ai';
import { parseNoteCards, serializeNoteMcq } from './parseNoteCards';

export type CardStyle = 'mixed' | 'basic' | 'cloze' | 'mcq';

export type BasicFillKind = 'answer' | 'question';

/** Prompt that asks for a single missing Front or Back side. */
export function buildBasicFillPrompt(kind: BasicFillKind, text: string): string {
  const value = text.trim();
  if (kind === 'answer') {
    return [
      'Complete this flashcard. Reply with ONLY the short answer — a word, phrase, or one short sentence.',
      'No quotes, labels, prefixes, or explanation.',
      '',
      `Question: ${value}`,
    ].join('\n');
  }
  return [
    'Write a clear flashcard question for which the text below is the correct answer.',
    'Reply with ONLY the question. No quotes, labels, prefixes, or explanation.',
    '',
    `Answer: ${value}`,
  ].join('\n');
}

/** Strip model fluff so the reply can drop straight into Front or Back. */
export function parseFillReply(text: string): string {
  const line = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((row) => row.trim())
    .find(Boolean);
  if (!line) return '';
  return line
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/^(?:answer|question|front|back)\s*[:：\-–—]\s*/i, '')
    .trim();
}

/**
 * Run Create Cards AI on OpenRouter Qwen Flash (cheap/fast).
 * Uses a larger token budget so reasoning models do not hit finish_reason=length with empty content.
 * Falls back to the app's current provider when the live AI bridge is unavailable (tests / demo).
 */
export async function completeCardGeneration(
  client: AiClient,
  request: { prompt: string; context?: string },
): Promise<string> {
  const context = request.context ? truncateNoteContext(request.context, 1500) : undefined;
  const payload = {
    prompt: request.prompt,
    context,
    maxTokens: 8192,
    temperature: 0.2,
    operation: 'create_card_fill',
  };
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
