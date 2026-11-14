import { UpstreamFailure } from "./openrouter";

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

export const REFUSED: MappedError = {
  status: 422,
  code: "refused",
  message: "The model declined to answer this request.",
};

export const UPSTREAM_RATE_LIMITED: MappedError = {
  status: 503,
  code: "upstream_rate_limited",
  message: "The AI service is busy. Try again shortly.",
};

export const UPSTREAM_OUT_OF_CREDITS: MappedError = {
  status: 503,
  code: "upstream_out_of_credits",
  message: "AI is temporarily unavailable",
};

export const UPSTREAM_ERROR: MappedError = {
  status: 502,
  code: "upstream_error",
  message: "The AI service returned an error.",
};

/**
 * Maps OpenRouter failures to stable codes. Never includes upstream bodies or
 * headers, so nothing about the API key or OpenRouter's raw error reaches the client.
 *
 * - moderation flagged (403 with reasons, or a flagged stream error) → 422 refused
 * - 402 insufficient credits / key limit reached → 503 upstream_out_of_credits
 * - 429 → 503 upstream_rate_limited
 * - 401/403 key problems, 400, 408, 5xx, timeouts, network errors → 502 upstream_error
 */
export function mapUpstreamError(err: unknown): MappedError {
  if (err instanceof UpstreamFailure) {
    if (err.flagged) return REFUSED;
    if (err.status === 402) return UPSTREAM_OUT_OF_CREDITS;
    if (err.status === 429) return UPSTREAM_RATE_LIMITED;
    return UPSTREAM_ERROR;
  }
  return { status: 500, code: "internal_error", message: "Unexpected server error." };
}
