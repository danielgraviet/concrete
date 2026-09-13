/** AI provider boundary types. */

import type {
  GenerateQuizRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from '../quiz/types';

export type CompleteRequest = {
  prompt: string;
  context?: string;
};

export type { GenerateQuizRequest, GradeQuizRequest, GradeReport, QuizDocument };

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: CompleteRequest): Promise<string>;
  embed?(text: string): Promise<number[]>;
  /** Optional structured quiz generation (stubbed until live keys). */
  generateQuiz?(request: GenerateQuizRequest): Promise<QuizDocument>;
  /** Optional rubric grading (stubbed until live keys). */
  gradeQuiz?(request: GradeQuizRequest): Promise<GradeReport>;
}
