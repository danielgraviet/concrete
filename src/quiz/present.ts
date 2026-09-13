import { createRng, hashSeed, optionLetter, shuffledCopy } from './shuffle';
import type {
  PresentedMcqQuestion,
  PresentedQuestion,
  QuizDocument,
  QuizQuestion,
} from './types';

/** Build a take-session presentation: shuffle MCQ options, assign letters after shuffle. */
export function presentQuiz(
  doc: QuizDocument,
  sessionSeed: string,
): PresentedQuestion[] {
  const rng = createRng(hashSeed(sessionSeed));
  return doc.questions.map((q) => presentQuestion(q, rng));
}

function presentQuestion(
  question: QuizQuestion,
  rng: () => number,
): PresentedQuestion {
  if (question.type !== 'mcq') return question;

  const options = shuffledCopy(question.options, rng).map((opt, index) => ({
    ...opt,
    letter: optionLetter(index),
  }));

  const presented: PresentedMcqQuestion = {
    id: question.id,
    type: 'mcq',
    prompt: question.prompt,
    options,
  };
  return presented;
}

/** Split cloze prompt into text/blank segments for the take UI. */
export function clozeSegments(
  prompt: string,
): Array<{ type: 'text'; value: string } | { type: 'blank'; answer: string; index: number }> {
  const segments: Array<
    { type: 'text'; value: string } | { type: 'blank'; answer: string; index: number }
  > = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let blankIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt))) {
    if (match.index > last) {
      segments.push({ type: 'text', value: prompt.slice(last, match.index) });
    }
    segments.push({ type: 'blank', answer: match[1].trim(), index: blankIndex });
    blankIndex += 1;
    last = match.index + match[0].length;
  }
  if (last < prompt.length) {
    segments.push({ type: 'text', value: prompt.slice(last) });
  }
  return segments;
}
