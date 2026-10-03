import { parseQuizMarkdown } from '../quiz/parseQuizMarkdown';
import type { QuizQuestion } from '../quiz/types';
import { cardFingerprint, cardIdFor } from './cardId';
import { mightContainCards, parseNoteCards } from './parseNoteCards';
import type { CardDraft as Draft, ReviewCard } from './types';

function withIds(drafts: Draft[]): ReviewCard[] {
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    const base = cardIdFor(cardFingerprint(draft));
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    // Identical cards in one note stay distinct.
    return { ...draft, id: count === 1 ? base : `${base}~${count}` } as ReviewCard;
  });
}

/** Cards written with card syntax in a regular note. */
export function cardsFromNote(path: string, markdown: string): ReviewCard[] {
  if (!mightContainCards(markdown)) return [];
  const drafts: Draft[] = [];
  for (const card of parseNoteCards(markdown)) {
    const source = { path, line: card.line, origin: 'note' as const };
    if (card.kind === 'basic') {
      drafts.push({ kind: 'basic', front: card.front, back: card.back, source });
      continue;
    }
    if (card.kind === 'cloze') {
      drafts.push({ kind: 'cloze', text: card.text, group: card.group, source });
      continue;
    }
    if (!card.options.some((option) => option.correct)) continue;
    const draft: Draft = {
      kind: 'mcq',
      question: {
        id: '',
        type: 'mcq',
        prompt: card.prompt,
        options: card.options.map((option, index) => ({
          id: `opt-${index + 1}`,
          text: option.text,
          correct: option.correct,
        })),
      },
      source,
    };
    const idBase = cardIdFor(cardFingerprint(draft));
    drafts.push({
      ...draft,
      question: {
        ...draft.question,
        id: `${idBase}-q`,
        options: draft.question.options.map((option, index) => ({
          ...option,
          id: `${idBase}-opt-${index + 1}`,
        })),
      },
    });
  }
  return withIds(drafts);
}

export function quizQuestionDraft(question: QuizQuestion, path: string, line: number): Draft | null {
  const source = { path, line, origin: 'quiz' as const };
  switch (question.type) {
    case 'mcq':
      return question.options.some((option) => option.correct) ? { kind: 'mcq', question, source } : null;
    case 'cloze':
      // Every blank in a quiz cloze is one question, so hide them together. A blank
      // wrapped in inline code moves the backticks inside, since note-card parsing
      // never looks for blanks in code.
      return {
        kind: 'cloze',
        text: question.prompt.replace(/(`?)\{\{([^}]+)\}\}\1/g, (_, tick: string, answer: string) =>
          `{{1::${tick}${answer.trim()}${tick}}}`,
        ),
        group: '1',
        source,
      };
    case 'open':
      return {
        kind: 'basic',
        front: question.prompt,
        back: [question.answer, ...(question.keyPoints?.length ? ['', ...question.keyPoints.map((p) => `- ${p}`)] : [])].join('\n').trim(),
        source,
      };
    case 'code': {
      const snippet = question.snippet ? `\n\n\`\`\`${question.language}\n${question.snippet}\n\`\`\`` : '';
      const back = [
        question.kind === 'predict-output' ? `\`\`\`text\n${question.expected}\n\`\`\`` : question.expected,
        ...(question.keyPoints?.length ? ['', ...question.keyPoints.map((p) => `- ${p}`)] : []),
        ...(question.explanation ? ['', question.explanation] : []),
      ].join('\n').trim();
      return { kind: 'basic', front: `${question.prompt}${snippet}`, back, source };
    }
  }
}

/** Line of each question's `##` heading, skipping code fences (mirrors parseQuizMarkdown). */
export function quizHeadingLines(markdown: string): number[] {
  const headingLines: number[] = [];
  let fence: string | null = null;
  markdown.split('\n').forEach((line, index) => {
    const open = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
    } else if (open) {
      fence = open[1];
    } else if (/^##\s+/.test(line)) {
      headingLines.push(index);
    }
  });
  return headingLines;
}

/** Every question of a quiz file as a card (whether it's in review is decided by the store). */
export function cardsFromQuiz(path: string, markdown: string): ReviewCard[] {
  let questions: QuizQuestion[];
  try {
    questions = parseQuizMarkdown(markdown).questions;
  } catch {
    return [];
  }
  const headingLines = quizHeadingLines(markdown);
  const drafts = questions.flatMap((question, index) => {
    const draft = quizQuestionDraft(question, path, headingLines[index] ?? 0);
    return draft ? [draft] : [];
  });
  return withIds(drafts);
}

/** Map a quiz question id (`q-3`) to its card, by position. */
export function quizCardForQuestion(cards: ReviewCard[], markdown: string, questionId: string): ReviewCard | undefined {
  let questions: QuizQuestion[];
  try {
    questions = parseQuizMarkdown(markdown).questions;
  } catch {
    return undefined;
  }
  const question = questions.find((q) => q.id === questionId);
  if (!question) return undefined;
  const draft = quizQuestionDraft(question, '', 0);
  if (!draft) return undefined;
  const fingerprint = cardFingerprint(draft);
  return cards.find((card) => cardFingerprint(card) === fingerprint);
}
