/** Mirrors the records written by telemetrySpans.cjs in the main process. */
export type SpanTokens = {
  /** All input tokens, cache reads and writes included. */
  prompt: number;
  completion: number;
  /** Subset of completion. */
  reasoning: number;
  /** Subsets of prompt. */
  cacheRead: number;
  cacheWrite: number;
};

/**
 * provider: billed price reported by the provider. estimated: provider total
 * split across calls. subscription: notional API price for a CLI-login run.
 */
export type CostSource = 'provider' | 'estimated' | 'subscription' | 'unpriced';

export type TelemetrySpan = {
  traceId: string;
  spanId: string;
  parentId: string | null;
  kind: 'llm' | 'tool' | 'agent_run';
  backend: string;
  /** Feature that made the call: quiz_generation, create_card_fill, agent, … */
  source: string;
  model: string | null;
  toolName?: string;
  startedAt: number;
  durationMs: number;
  status: 'ok' | 'error' | 'cancelled';
  error?: string;
  finishReason?: string;
  tokens: SpanTokens;
  costUsd: number | null;
  costSource: CostSource;
  llmCalls?: number;
  toolCalls?: number;
};
