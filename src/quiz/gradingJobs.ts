import type { AiClient } from '../ai/AiClient';
import { buildQuizAttempt, type QuizHistoryStore } from './history';
import type { GradeReport, QuizDocument, QuizResponse } from './types';

/**
 * Grading runs here, outside the quiz view, so it keeps going (and gets saved)
 * when the student opens another note. One job per quiz path.
 */
export type QuizGradingJob = {
  path: string;
  title: string;
  sessionSeed: string;
  startedAt: number;
  /** How many quizzes the student has taken, counting this one. */
  quizNumber: number;
  responses: Record<string, QuizResponse>;
  status: 'grading' | 'graded' | 'error';
  report?: GradeReport;
  error?: string;
  /** Finished, but the student hasn't opened the quiz since. */
  unseen: boolean;
  toastDismissed: boolean;
};

type StartOptions = {
  path: string;
  quiz: QuizDocument;
  responses: Record<string, QuizResponse>;
  sessionSeed: string;
  startedAt: number;
  client: AiClient;
  history: QuizHistoryStore;
};

/** Add the reference answer to any question that was not fully correct. */
function withCorrectAnswers(report: GradeReport, quiz: QuizDocument): GradeReport {
  return {
    ...report,
    perQuestion: report.perQuestion.map((item) => {
      const question = quiz.questions.find((q) => q.id === item.questionId);
      if (!question || item.score >= item.maxScore) return item;
      const correctAnswer = question.type === 'mcq'
        ? question.options.filter((option) => option.correct).map((option) => option.text).join(', ')
        : question.type === 'cloze'
          ? question.answers.join(', ')
          : question.type === 'code'
            ? question.expected
            : question.answer;
      return { ...item, correctAnswer };
    }),
  };
}

class QuizGradingJobs {
  private jobs = new Map<string, QuizGradingJob>();
  private snapshot: QuizGradingJob[] = [];
  private listeners = new Set<() => void>();

  get = (path: string): QuizGradingJob | undefined => this.jobs.get(path);
  getAll = (): QuizGradingJob[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start({ path, quiz, responses, sessionSeed, startedAt, client, history }: StartOptions): void {
    if (this.jobs.get(path)?.status === 'grading') return;
    this.set({
      path, title: quiz.title, sessionSeed, startedAt, responses,
      quizNumber: history.getAll().length + 1,
      status: 'grading', unseen: false, toastDismissed: false,
    });
    void (async () => {
      try {
        const raw = await client.gradeQuiz({ quiz, responses: Object.values(responses), rubric: quiz.rubric });
        const report = withCorrectAnswers(raw, quiz);
        history.add(buildQuizAttempt(quiz, report, path, startedAt, Date.now(), sessionSeed, responses));
        this.finish(path, sessionSeed, { status: 'graded', report });
      } catch (err) {
        this.finish(path, sessionSeed, { status: 'error', error: err instanceof Error ? err.message : 'Grading failed' });
      }
    })();
  }

  markSeen(path: string): void {
    const job = this.jobs.get(path);
    if (job?.unseen) this.set({ ...job, unseen: false, toastDismissed: true });
  }

  dismissToast(path: string): void {
    const job = this.jobs.get(path);
    if (job && !job.toastDismissed) this.set({ ...job, toastDismissed: true });
  }

  clear(path: string): void {
    if (this.jobs.delete(path)) this.emit();
  }

  private finish(path: string, sessionSeed: string, result: Pick<QuizGradingJob, 'status' | 'report' | 'error'>): void {
    const job = this.jobs.get(path);
    // Retaken or cleared while grading: the attempt is saved, but don't resurrect the job.
    if (!job || job.sessionSeed !== sessionSeed) return;
    this.set({ ...job, ...result, unseen: true });
  }

  private set(job: QuizGradingJob): void {
    this.jobs.set(job.path, job);
    this.emit();
  }

  private emit(): void {
    this.snapshot = [...this.jobs.values()];
    for (const listener of this.listeners) listener();
  }
}

export const quizGradingJobs = new QuizGradingJobs();
