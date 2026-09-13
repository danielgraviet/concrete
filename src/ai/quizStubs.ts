import { applyQuizGuardrails } from '../quiz/guardrails';
import type {
  GenerateQuizRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
  QuizResponse,
} from '../quiz/types';

const DEFAULT_RUBRIC =
  'Score correctness, conceptual precision, and use of required terms. Partial credit allowed. Penalize pure guessing on open items.';

/** Deterministic stub quiz used until a live provider is configured. */
export function stubGenerateQuiz(request: GenerateQuizRequest): QuizDocument {
  const topic = request.topic.trim() || 'Untitled';
  const title = topic.startsWith('Quiz ') ? topic : `Quiz ${topic}`;
  const types = request.types?.length ? request.types : (['mcq', 'cloze', 'open'] as const);

  const questions: QuizDocument['questions'] = [];

  if (types.includes('mcq')) {
    questions.push({
      id: 'q-1',
      type: 'mcq',
      prompt: `Which statement best matches “${topic}”?`,
      options: [
        {
          id: 'q-1-opt-1',
          text: 'A vague related idea that sounds plausible',
          correct: false,
        },
        {
          id: 'q-1-opt-2',
          text: `The core definition or claim about ${topic}`,
          correct: true,
        },
        {
          id: 'q-1-opt-3',
          text: 'An unrelated concept from a different unit',
          correct: false,
        },
        {
          id: 'q-1-opt-4',
          text: 'A common misconception learners often pick',
          correct: false,
        },
      ],
    });
  }

  if (types.includes('cloze')) {
    questions.push({
      id: 'q-2',
      type: 'cloze',
      prompt: `In your notes, {{${topic}}} is the idea you should be able to explain without looking.`,
      answers: [topic],
    });
  }

  if (types.includes('open')) {
    questions.push({
      id: 'q-3',
      type: 'open',
      prompt: `Explain ${topic} in your own words. Include one concrete example.`,
      answer: `A clear explanation of ${topic} with one concrete example drawn from the note.`,
    });
  }

  return applyQuizGuardrails(
    {
      title,
      source: request.source,
      rubric: DEFAULT_RUBRIC,
      questions,
    },
    `${title}:${request.noteContext?.slice(0, 40) ?? ''}`,
  );
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function gradeMcq(
  questionId: string,
  correctIds: string[],
  selectedIds: string[],
): { score: number; maxScore: number; feedback: string } {
  const maxScore = 1;
  const selected = new Set(selectedIds);
  const correct = new Set(correctIds);
  const exact =
    selected.size === correct.size && [...correct].every((id) => selected.has(id));
  if (exact) {
    return { score: 1, maxScore, feedback: 'Correct.' };
  }
  const partial = [...selected].some((id) => correct.has(id));
  if (partial) {
    return { score: 0.5, maxScore, feedback: 'Partially correct. Review the options you missed.' };
  }
  return { score: 0, maxScore, feedback: 'Incorrect. Revisit the related note section.' };
}

function gradeCloze(
  answers: string[],
  fills: string[],
): { score: number; maxScore: number; feedback: string } {
  const maxScore = Math.max(answers.length, 1);
  let score = 0;
  answers.forEach((answer, i) => {
    if (normalize(fills[i] ?? '') === normalize(answer)) score += 1;
  });
  if (score === maxScore) {
    return { score, maxScore, feedback: 'All blanks correct.' };
  }
  if (score > 0) {
    return { score, maxScore, feedback: 'Some blanks need another look.' };
  }
  return { score: 0, maxScore, feedback: 'Blanks did not match the expected terms.' };
}

function gradeOpen(
  reference: string,
  text: string,
): { score: number; maxScore: number; feedback: string } {
  const maxScore = 1;
  if (!text.trim()) {
    return { score: 0, maxScore, feedback: 'No response submitted.' };
  }
  const refTokens = new Set(
    normalize(reference)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3),
  );
  const responseTokens = new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3),
  );
  let overlap = 0;
  for (const token of refTokens) {
    if (responseTokens.has(token)) overlap += 1;
  }
  const ratio = refTokens.size === 0 ? 0.6 : overlap / refTokens.size;
  if (ratio >= 0.45 || text.trim().length > 80) {
    return {
      score: 0.75,
      maxScore,
      feedback:
        'Stub grader: response looks substantive. A live model will score against the rubric.',
    };
  }
  if (text.trim().length > 20) {
    return {
      score: 0.4,
      maxScore,
      feedback: 'Stub grader: thin overlap with the reference. Expand with key terms.',
    };
  }
  return {
    score: 0.15,
    maxScore,
    feedback: 'Stub grader: answer too short to evaluate well.',
  };
}

/** Local heuristic grader used until OpenAI/Anthropic keys are configured. */
export function stubGradeQuiz(request: GradeQuizRequest): GradeReport {
  const rubric = request.rubric?.trim() || request.quiz.rubric;
  const byId = new Map(request.responses.map((r) => [r.questionId, r]));
  const perQuestion = request.quiz.questions.map((q) => {
    const response = byId.get(q.id);
    let result = { score: 0, maxScore: 1, feedback: 'No answer submitted.' };
    if (response) {
      if (q.type === 'mcq' && response.type === 'mcq') {
        const correctIds = q.options.filter((o) => o.correct).map((o) => o.id);
        result = gradeMcq(q.id, correctIds, response.selectedIds);
      } else if (q.type === 'cloze' && response.type === 'cloze') {
        result = gradeCloze(q.answers, response.fills);
      } else if (q.type === 'open' && response.type === 'open') {
        result = gradeOpen(q.answer, response.text);
      }
    }
    return {
      questionId: q.id,
      score: result.score,
      maxScore: result.maxScore,
      feedback: result.feedback,
    };
  });

  const score = perQuestion.reduce((s, q) => s + q.score, 0);
  const maxScore = perQuestion.reduce((s, q) => s + q.maxScore, 0) || 1;
  const percent = Math.round((score / maxScore) * 100);

  return {
    score,
    maxScore,
    percent,
    feedback: `Stub rubric grade (${percent}%). ${rubric}`,
    perQuestion,
    stubbed: true,
  };
}

export type { QuizResponse };
