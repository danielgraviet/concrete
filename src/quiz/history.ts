import type { GradeReport, QuizDocument } from './types';

export type QuestionAttempt = {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  /** Question type / code kind, for tracking weak spots by skill. */
  type?: string;
  kind?: string;
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
      };
    }),
    stubbed: report.stubbed,
  };
}

export class QuizHistoryStore {
  private attempts: QuizAttempt[] = [];
  private readonly key: string;

  constructor(vaultRoot = '') {
    this.key = `mv:quiz-history:${vaultRoot || '__default__'}`;
    this.load();
  }

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
    try { localStorage.setItem(this.key, JSON.stringify({ version: 1, attempts: this.attempts } satisfies QuizHistoryFile)); } catch { /* storage is optional */ }
  }
}
