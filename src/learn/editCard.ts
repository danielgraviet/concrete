import { parseQuizMarkdown } from '../quiz/parseQuizMarkdown';
import { serializeQuestion } from '../quiz/serializeQuizMarkdown';
import type { QuizQuestion } from '../quiz/types';
import { cardsFromNote, cardsFromQuiz, quizHeadingLines, quizQuestionDraft } from './buildCards';
import { cardFingerprint } from './cardId';
import { parseNoteCardSpans, type NoteCardSpan } from './parseNoteCards';
import type { Migration } from './reconcile';
import type { ReviewCard } from './types';

export type CardEdit =
  | { kind: 'basic'; front: string; back: string }
  | { kind: 'cloze'; text: string }
  /** A card from a quiz file: the whole question is edited and written back. */
  | { kind: 'quiz'; question: QuizQuestion };

export type CardEditResult =
  | { ok: true; markdown: string; card: ReviewCard; migrations: Migration[] }
  | { ok: false; error: string };

const PREFIX_RE = /^\s*(?:>\s?)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;

/** Multiple-choice cards only come from quizzes; every other card can be edited. */
export function canEditCard(card: ReviewCard): boolean {
  return card.source.origin === 'quiz' || card.kind !== 'mcq';
}

/** The quiz question a card was built from, or null if the quiz changed since. */
export function quizQuestionForCard(markdown: string, card: ReviewCard): { question: QuizQuestion; index: number } | null {
  if (card.source.origin !== 'quiz') return null;
  let questions: QuizQuestion[];
  try {
    questions = parseQuizMarkdown(markdown).questions;
  } catch {
    return null;
  }
  const index = quizHeadingLines(markdown).indexOf(card.source.line);
  const question = questions[index];
  const draft = question ? quizQuestionDraft(question, card.source.path, card.source.line) : null;
  if (!draft || cardFingerprint(draft) !== cardFingerprint(card)) return null;
  return { question, index };
}

/** First line after a question's section (the next `#`/`##` heading outside code, or the end). */
function quizSectionEnd(lines: string[], start: number): number {
  let fence: string | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const open = /^\s*(```+|~~~+)/.exec(lines[i]);
    if (fence) {
      if (lines[i].trim().startsWith(fence)) fence = null;
    } else if (open) {
      fence = open[1];
    } else if (/^#{1,2}\s+/.test(lines[i])) {
      return i;
    }
  }
  return lines.length;
}

function sameQuestion(a: QuizQuestion, b: QuizQuestion): boolean {
  const strip = (q: QuizQuestion) =>
    JSON.stringify({ ...q, id: '', ...(q.type === 'mcq' ? { options: q.options.map(({ text, correct }) => ({ text, correct })) } : {}) });
  return strip(a) === strip(b);
}

function trimQuestion(question: QuizQuestion): QuizQuestion {
  const keyPoints = (points?: string[]) => {
    const kept = points?.map((p) => p.trim()).filter(Boolean);
    return kept?.length ? kept : undefined;
  };
  const optional = (value?: string) => value?.trim() || undefined;
  switch (question.type) {
    case 'mcq':
      return { ...question, prompt: question.prompt.trim(), options: question.options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text) };
    case 'cloze': {
      const prompt = question.prompt.trim();
      const answers = [...prompt.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
      return { ...question, prompt, answers, explanation: optional(question.explanation) };
    }
    case 'open':
      return { ...question, prompt: question.prompt.trim(), answer: question.answer.trim(), keyPoints: keyPoints(question.keyPoints) };
    case 'code': {
      const snippet = question.snippet.replace(/\s+$/, '');
      return {
        ...question,
        // Without a snippet there's no fence to carry a language; parsing defaults it.
        ...(snippet ? { snippet } : { snippet: '', language: 'python' }),
        prompt: question.prompt.trim(),
        expected: question.expected.trim(),
        keyPoints: keyPoints(question.keyPoints),
        explanation: optional(question.explanation),
      };
    }
  }
}

function questionProblem(question: QuizQuestion): string | null {
  if (!question.prompt) return 'The question can’t be empty.';
  if (question.type === 'mcq' && !question.options.some((o) => o.correct)) return 'Mark at least one option as correct.';
  if (question.type === 'cloze' && !/\{\{[^}]+\}\}/.test(question.prompt)) return 'Keep at least one {{blank}} in the question.';
  if (question.type === 'open' && !question.answer) return 'The answer can’t be empty.';
  if (question.type === 'code' && !question.expected) return 'The answer can’t be empty.';
  return null;
}

function applyQuizEdit(markdown: string, card: ReviewCard, edited: QuizQuestion): CardEditResult {
  const found = quizQuestionForCard(markdown, card);
  if (!found) return { ok: false, error: 'The quiz changed since this card was loaded. Open it to edit the question.' };
  let question = trimQuestion({ ...edited, id: found.question.id, type: found.question.type } as QuizQuestion);
  // A verified output stops being verified once someone rewrites it.
  if (question.type === 'code' && found.question.type === 'code' && question.verified && question.expected !== found.question.expected.trim()) {
    const { verified: _verified, ...rest } = question;
    question = rest;
  }
  const problem = questionProblem(question);
  if (problem) return { ok: false, error: problem };

  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const start = card.source.line;
  const end = quizSectionEnd(lines, start);
  const section = serializeQuestion(question, found.index).replace(/\n+$/, '').split('\n');
  // Keep the heading as written (it may number questions differently).
  const heading = /^##\s+Q\d+\s*[·•\-–—]\s*(mcq|cloze|open|code)\s*$/i.test(lines[start]) ? lines[start] : section[0];
  const next = [...lines.slice(0, start), heading, ...section.slice(1), ...(end < lines.length ? [''] : []), ...lines.slice(end)].join(newline);

  const reparsed = parseQuizMarkdown(next).questions[found.index];
  if (!reparsed || !sameQuestion(reparsed, question)) {
    return { ok: false, error: 'That edit wouldn’t be read back as the same question. Open the quiz to edit it.' };
  }
  // A quiz edit changes one question, so its cards line up one to one.
  const path = card.source.path;
  const before = cardsFromQuiz(path, markdown);
  const after = cardsFromQuiz(path, next);
  if (before.length !== after.length) return { ok: false, error: 'That edit would change which questions are cards.' };
  const oldIndex = before.findIndex((c) => c.source.line === start);
  const migrations = before.map((c, i) => ({ from: i === oldIndex ? card.id : c.id, to: after[i].id }));
  return { ok: true, markdown: next, card: after[oldIndex], migrations };
}

function spanMatches(span: NoteCardSpan, card: ReviewCard): boolean {
  if (span.line !== card.source.line || span.kind !== card.kind) return false;
  const draft =
    span.kind === 'basic'
      ? { kind: 'basic' as const, front: span.front, back: span.back, source: card.source }
      : { kind: 'cloze' as const, text: span.text, group: span.group, source: card.source };
  return cardFingerprint(draft) === cardFingerprint(card);
}

function basicLines(prefix: string, front: string, back: string, span: NoteCardSpan): string[] {
  const multiline = front.includes('\n') || back.includes('\n');
  if (span.layout === 'inline' && !multiline) return [`${prefix}${front} ${span.paired ? ':::' : '::'} ${back}`];
  return [`${prefix}${front}`, span.paired ? '??' : '?', back];
}

/** Pair the cards a span held before and after an edit, so each keeps its history. */
function pairCards(before: ReviewCard[], after: ReviewCard[]): Migration[] {
  const key = (card: ReviewCard, index: number) => (card.kind === 'cloze' ? `c:${card.group}` : `b:${index}`);
  const afterByKey = new Map(after.map((card, index) => [key(card, index), card]));
  const pairs: Migration[] = [];
  const leftBefore: ReviewCard[] = [];
  const used = new Set<ReviewCard>();
  before.forEach((card, index) => {
    const match = afterByKey.get(key(card, index));
    if (match) {
      pairs.push({ from: card.id, to: match.id });
      used.add(match);
    } else {
      leftBefore.push(card);
    }
  });
  // Cloze groups that were renumbered: pair what's left in order.
  const leftAfter = after.filter((card) => !used.has(card));
  leftBefore.forEach((card, index) => {
    if (leftAfter[index]) pairs.push({ from: card.id, to: leftAfter[index].id });
  });
  return pairs;
}

/**
 * Rewrite one card in its note and work out which ids its history moves to.
 * `card` must be a card from `markdown` (its line and text are used to find it).
 */
export function applyCardEdit(markdown: string, card: ReviewCard, edit: CardEdit): CardEditResult {
  if (edit.kind === 'quiz') return applyQuizEdit(markdown, card, edit.question);
  if (!canEditCard(card) || card.source.origin !== 'note' || edit.kind !== card.kind) {
    return { ok: false, error: 'This card can’t be edited here.' };
  }
  const spans = parseNoteCardSpans(markdown);
  const span = spans.find((candidate) => spanMatches(candidate, card));
  if (!span) return { ok: false, error: 'The note changed since this card was loaded. Open the note to edit it.' };

  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const prefix = PREFIX_RE.exec(lines[span.line])?.[0] ?? '';

  let replacement: string[];
  let wanted: { front: string; back: string } | { text: string };
  if (edit.kind === 'basic') {
    const front = edit.front.trim();
    const back = edit.back.trim();
    if (!front || !back) return { ok: false, error: 'A card needs both a front and a back.' };
    // A reversed card is stored the other way round in the note.
    replacement = span.reverse ? basicLines(prefix, back, front, span) : basicLines(prefix, front, back, span);
    wanted = { front, back };
  } else {
    const text = edit.text.trim();
    if (!text) return { ok: false, error: 'A cloze card needs some text.' };
    replacement = [`${prefix}${text}`];
    wanted = { text };
  }

  const next = [...lines.slice(0, span.line), ...replacement.join('\n').split('\n'), ...lines.slice(span.end)].join(newline);

  // Cards come out of `cardsFromNote` in the same order as their spans.
  const path = card.source.path;
  const before = cardsFromNote(path, markdown).filter((c) => c.source.line === span.line);
  const after = cardsFromNote(path, next).filter((c) => c.source.line === span.line);
  const oldId = before[spans.filter((s) => s.line === span.line).indexOf(span)]?.id;
  // The vault-wide id can carry a suffix for text shared with another note.
  const migrations = pairCards(before, after).map((m) => (m.from === oldId ? { ...m, from: card.id } : m));
  const editedId = migrations.find((m) => m.from === card.id)?.to;
  const edited = after.find((c) => c.id === editedId);

  const matches =
    edited &&
    ('text' in wanted
      ? edited.kind === 'cloze' && edited.text === wanted.text
      : edited.kind === 'basic' && edited.front === wanted.front && edited.back === wanted.back);
  if (!edited || !matches) {
    return {
      ok: false,
      error:
        edit.kind === 'cloze'
          ? 'That text wouldn’t be read back as the same cloze card. Keep at least one {{blank}}.'
          : 'That edit wouldn’t be read back as the same card (a blank line ends the answer). Edit it in the note instead.',
    };
  }
  return { ok: true, markdown: next, card: edited, migrations };
}
