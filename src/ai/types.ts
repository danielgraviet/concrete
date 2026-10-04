/** AI provider boundary types. */

import type {
  GenerateQuizRequest,
  GenerateQuizFollowUpRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from '../quiz/types';

export type CompleteRequest = {
  prompt: string;
  context?: string;
  /** Override the provider default completion budget. */
  maxTokens?: number;
  temperature?: number;
  /** Activity-log operation label. */
  operation?: string;
};

export type { GenerateQuizRequest, GenerateQuizFollowUpRequest, GradeQuizRequest, GradeReport, QuizDocument };

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: CompleteRequest): Promise<string>;
  embed?(text: string): Promise<number[]>;
  /** Optional structured quiz generation (stubbed until live keys). */
  generateQuiz?(request: GenerateQuizRequest): Promise<QuizDocument>;
  /** Generate one optional practice follow-up for a graded open/code answer. */
  generateQuizFollowUp?(request: GenerateQuizFollowUpRequest): Promise<string>;
  /** Optional rubric grading (stubbed until live keys). */
  gradeQuiz?(request: GradeQuizRequest): Promise<GradeReport>;
}
