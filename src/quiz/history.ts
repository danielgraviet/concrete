import type { GradeReport, QuizDocument, QuizQuestion, QuizResponse } from './types';

export type QuestionAttempt = {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  /** Question type / code kind, for tracking weak spots by skill. */
  type?: string;
  kind?: string;
  /** What was asked and answered, so past attempts can be reviewed. Missing on older attempts. */
  prompt?: string;
  answer?: string;
  feedback?: string;
  correctAnswer?: string;
  missing?: string[];
};

export type QuizAttempt = {
  id: string;
  quizPath: string;
  quizTitle: string;
  sourcePaths: string[];
  startedAt: number;
  completedAt: number;
  score: number;
  maxScore: number;
  percent: number;
  questionCount: number;
  perQuestion: QuestionAttempt[];
  stubbed: boolean;
};

export type QuizHistoryFile = { version: 1; attempts: QuizAttempt[] };

export function buildQuizAttempt(
  quiz: QuizDocument,
  report: GradeReport,
  quizPath: string,
  startedAt: number,
  completedAt: number,
  id: string,
  responses: Record<string, QuizResponse> = {},
): QuizAttempt {
  return {
    id, quizPath, quizTitle: quiz.title,
    sourcePaths: quiz.source ? [quiz.source] : [],
    startedAt, completedAt, score: report.score, maxScore: report.maxScore,
    percent: report.percent, questionCount: quiz.questions.length,
    perQuestion: report.perQuestion.map((q) => {
      const question = quiz.questions.find((item) => item.id === q.questionId);
      return {
        questionId: q.questionId, score: q.score, maxScore: q.maxScore,
        correct: q.score >= q.maxScore,
        type: question?.type,
        ...(question?.type === 'code' ? { kind: question.kind } : {}),
        ...(question ? { prompt: promptText(question), answer: answerText(question, responses[q.questionId]) } : {}),
        feedback: q.feedback,
        ...(q.correctAnswer ? { correctAnswer: q.correctAnswer } : {}),
        ...(q.missing?.length ? { missing: q.missing } : {}),
      };
    }),
    stubbed: report.stubbed,
  };
}

/** Question prompt as plain text; cloze blanks become underscores. */
function promptText(question: QuizQuestion): string {
  return question.type === 'cloze' ? question.prompt.replace(/\{\{[^}]+\}\}/g, '_____') : question.prompt;
}

/** The student's answer as readable text ('' when left blank). */
function answerText(question: QuizQuestion, response: QuizResponse | undefined): string {
  if (!response) return '';
  if (response.type === 'mcq') {
    if (question.type !== 'mcq') return '';
    return question.options
      .filter((option) => response.selectedIds.includes(option.id))
      .map((option) => option.text)
      .join(', ');
  }
  if (response.type === 'cloze') return response.fills.some((fill) => fill.trim()) ? response.fills.join(' · ') : '';
  return response.text.trim();
}

export class QuizHistoryStore {
  private attempts: QuizAttempt[] = [];
  private readonly key: string;

  constructor(vaultRoot = '') {
    this.key = `mv:quiz-history:${vaultRoot || '__default__'}`;
    this.load();
  }

  /** Attempts at one quiz, newest first. */
  forQuiz(quizPath: string): QuizAttempt[] { return this.getAll().filter((attempt) => attempt.quizPath === quizPath); }
  getAll(): QuizAttempt[] { return [...this.attempts].sort((a, b) => b.completedAt - a.completedAt); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  add(attempt: QuizAttempt): void {
    if (this.attempts.some((item) => item.id === attempt.id)) return;
    this.attempts.push(attempt);
    this.persist();
    for (const listener of this.listeners) listener();
  }

  private listeners = new Set<() => void>();

  private load(): void {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.key) || '') as QuizHistoryFile;
      this.attempts = parsed.version === 1 && Array.isArray(parsed.attempts) ? parsed.attempts : [];
    } catch { this.attempts = []; }
  }

  private persist(): void {
    // Answer details are the bulky part. If storage is full, drop them from the
    // oldest attempts (scores stay) rather than failing to save anything.
    for (;;) {
      try {
        localStorage.setItem(this.key, JSON.stringify({ version: 1, attempts: this.attempts } satisfies QuizHistoryFile));
        return;
      } catch {
        const detailed = this.attempts
          .filter((attempt) => attempt.perQuestion.some((q) => q.prompt !== undefined))
          .sort((a, b) => a.completedAt - b.completedAt);
        if (detailed.length === 0) return; // storage is optional
        for (const attempt of detailed.slice(0, Math.ceil(detailed.length / 2))) {
          attempt.perQuestion = attempt.perQuestion.map(({ questionId, score, maxScore, correct, type, kind }) => ({ questionId, score, maxScore, correct, type, kind }));
        }
      }
    }
  }
}
