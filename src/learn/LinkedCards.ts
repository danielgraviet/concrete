import { parseClozeBlanks, type ParsedMcqOption } from './parseNoteCards';
import type { CardDraft, CardSource } from './types';

/**
 * A card made in the app. It lives in `.vault/cards.json`, not in the note, so
 * notes stay clean and answers keep any markdown (blank lines, math, lists).
 * `path` links it to the note it was made for.
 */
export type LinkedCardInput =
  | { kind: 'basic'; front: string; back: string; /** Also review back → front. */ reverse?: boolean }
  | { kind: 'cloze'; text: string }
  | { kind: 'mcq'; prompt: string; options: ParsedMcqOption[] };

export type LinkedCard = LinkedCardInput & { uid: string; path: string; created: number; /** Folder for cards created without a note. */ folder?: string };

/** Trim fields and drop empty MCQ options. */
export function cleanLinkedInput(input: LinkedCardInput): LinkedCardInput {
  if (input.kind === 'basic') {
    return { kind: 'basic', front: input.front.trim(), back: input.back.trim(), ...(input.reverse ? { reverse: true } : {}) };
  }
  if (input.kind === 'cloze') return { kind: 'cloze', text: input.text.trim() };
  return {
    kind: 'mcq',
    prompt: input.prompt.trim(),
    options: input.options.map((option) => ({ text: option.text.trim(), correct: option.correct })).filter((option) => option.text),
  };
}

/** Why a (cleaned) card can't be saved, or null. */
export function linkedInputProblem(input: LinkedCardInput): string | null {
  if (input.kind === 'basic') return input.front && input.back ? null : 'A card needs both a front and a back.';
  if (input.kind === 'cloze') {
    if (!input.text) return 'A cloze card needs some text.';
    return parseClozeBlanks(input.text).length ? null : 'Wrap the hidden answer in {{…}}.';
  }
  if (!input.prompt) return 'A multiple-choice card needs a question.';
  if (input.options.length < 2) return 'Add at least two options.';
  if (!input.options.some((option) => option.correct)) return 'Mark at least one option as correct.';
  return null;
}

/** An MCQ draft with option ids derived from its content (shared with note `?mcq` cards). */
export function mcqDraft(prompt: string, options: ParsedMcqOption[], source: CardSource, idBase: string): CardDraft {
  return {
    kind: 'mcq',
    question: {
      id: `${idBase}-q`,
      type: 'mcq',
      prompt,
      options: options.map((option, index) => ({ id: `${idBase}-opt-${index + 1}`, text: option.text, correct: option.correct })),
    },
    source,
  };
}

/** The review cards one linked card produces (a cloze gives one per blank group). */
export function draftsFromLinked(card: LinkedCard, idBaseFor: (draft: CardDraft) => string): CardDraft[] {
  const source: CardSource = { path: card.path, line: 0, origin: 'linked', uid: card.uid, ...(card.folder ? { folder: card.folder } : {}) };
  if (card.kind === 'basic') {
    const drafts: CardDraft[] = [{ kind: 'basic', front: card.front, back: card.back, source }];
    if (card.reverse) drafts.push({ kind: 'basic', front: card.back, back: card.front, source: { ...source, reverse: true } });
    return drafts;
  }
  if (card.kind === 'cloze') {
    const groups = [...new Set(parseClozeBlanks(card.text).map((blank) => blank.group))];
    return groups.map((group) => ({ kind: 'cloze', text: card.text, group, source }));
  }
  const bare = mcqDraft(card.prompt, card.options, source, '');
  return [mcqDraft(card.prompt, card.options, source, idBaseFor(bare))];
}
