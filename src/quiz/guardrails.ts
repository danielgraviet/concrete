import { createRng, hashSeed, shuffledCopy } from './shuffle';
import type { McqOption, McqQuestion, QuizDocument, QuizQuestion } from './types';
import { serializeQuizMarkdown } from './serializeQuizMarkdown';

const LETTER_PREFIX = /^\s*[A-Za-z][).:\-]\s+/;

function stripLetterPrefix(text: string): string {
  return text.replace(LETTER_PREFIX, '').trim();
}

function ensureOptionIds(question: McqQuestion, qIndex: number): McqQuestion {
  return {
    ...question,
    id: question.id || `q-${qIndex + 1}`,
    options: question.options.map((opt, i) => ({
      ...opt,
      id: opt.id || `q-${qIndex + 1}-opt-${i + 1}`,
      text: stripLetterPrefix(opt.text),
    })),
  };
}

function rebalanceMcqOptions(question: McqQuestion, seed: number): McqQuestion {
  const rng = createRng(seed);
  const options = shuffledCopy(question.options, rng);
  return { ...question, options };
}

/**
 * Normalize AI / stub quiz output:
 * - strip embedded A)/B) prefixes from options
 * - ensure ids
 * - require at least one correct MCQ option (mark first if missing)
 * - shuffle options so correct index / length bias does not stick in the file
 */
export function applyQuizGuardrails(doc: QuizDocument, seedInput = doc.title): QuizDocument {
  const baseSeed = hashSeed(seedInput);
  const questions: QuizQuestion[] = doc.questions.map((raw, qIndex) => {
    if (raw.type !== 'mcq') {
      return { ...raw, id: raw.id || `q-${qIndex + 1}` };
    }

    let question = ensureOptionIds(raw, qIndex);
    const correctCount = question.options.filter((o) => o.correct).length;
    if (correctCount === 0 && question.options.length > 0) {
      question = {
        ...question,
        options: question.options.map((o, i) => ({ ...o, correct: i === 0 })),
      };
    }

    // Soft length bias: if the unique longest option is the only correct one,
    // shuffle so file order is not "correct = longest".
    const lengths = question.options.map((o) => o.text.length);
    const maxLen = Math.max(0, ...lengths);
    const longest = question.options.filter((o) => o.text.length === maxLen);
    if (longest.length === 1 && longest[0].correct) {
      question = rebalanceMcqOptions(question, baseSeed + qIndex * 97 + 13);
    } else {
      question = rebalanceMcqOptions(question, baseSeed + qIndex * 97);
    }

    return question;
  });

  return {
    ...doc,
    title: doc.title.trim() || 'Quiz',
    rubric:
      doc.rubric.trim() ||
      'Score correctness, conceptual precision, and use of required terms. Partial credit allowed.',
    questions,
  };
}

/** Guardrail + serialize helper for vault writes. */
export function quizDocumentToMarkdown(doc: QuizDocument, seedInput?: string): string {
  return serializeQuizMarkdown(applyQuizGuardrails(doc, seedInput));
}

export function hasLetterPrefixedOptions(options: McqOption[]): boolean {
  return options.some((o) => LETTER_PREFIX.test(o.text));
}
