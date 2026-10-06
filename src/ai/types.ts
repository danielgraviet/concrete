/** AI provider boundary types. */

import type {
  GenerateQuizRequest,
  GenerateQuizFollowUpRequest,
  GradeQuizRequest,
  GradeReport,
  QuizDocument,
} from '../quiz/types';

export type OpenRouterProviderPrefs = {
  order?: string[];
  allow_fallbacks?: boolean;
  sort?: 'price' | 'throughput' | 'latency';
};

export type OpenRouterReasoningPrefs = {
  enabled?: boolean;
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  exclude?: boolean;
};

export type CompleteRequest = {
  prompt: string;
  context?: string;
  /** Override the provider default completion budget. */
  maxTokens?: number;
  temperature?: number;
  /** Activity-log operation label. */
  operation?: string;
  /** OpenRouter provider routing (e.g. pin Cerebras). */
  provider?: OpenRouterProviderPrefs;
  /** OpenRouter reasoning controls — disable for short fill completions. */
  reasoning?: OpenRouterReasoningPrefs;
};

/** One turn of a multi-turn chat (Study Chat). */
export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatRequest = {
  system: string;
  messages: ChatTurn[];
  /** Receives text chunks as they stream in. The resolved string is authoritative. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  /** Activity-log operation label. */
  operation?: string;
};

export type { GenerateQuizRequest, GenerateQuizFollowUpRequest, GradeQuizRequest, GradeReport, QuizDocument };

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: CompleteRequest): Promise<string>;
  /** Optional multi-turn, streamable chat. AiClient falls back to complete(). */
  chat?(request: ChatRequest): Promise<string>;
  embed?(text: string): Promise<number[]>;
  /** Optional structured quiz generation (stubbed until live keys). */
  generateQuiz?(request: GenerateQuizRequest): Promise<QuizDocument>;
  /** Generate one optional practice follow-up for a graded open/code answer. */
  generateQuizFollowUp?(request: GenerateQuizFollowUpRequest): Promise<string>;
  /** Optional rubric grading (stubbed until live keys). */
  gradeQuiz?(request: GradeQuizRequest): Promise<GradeReport>;
}
