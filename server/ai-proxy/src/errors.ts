import Anthropic from "@anthropic-ai/sdk";

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

/**
 * Maps upstream failures to stable codes. Never includes upstream bodies or headers,
 * so nothing about the API key or Anthropic's raw error can reach the client.
 */
export function mapUpstreamError(err: unknown): MappedError {
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 503, code: "upstream_rate_limited", message: "The AI service is busy. Try again shortly." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, code: "upstream_error", message: "The AI service returned an error." };
  }
  return { status: 500, code: "internal_error", message: "Unexpected server error." };
}

export const REFUSED: MappedError = {
  status: 422,
  code: "refused",
  message: "The model declined to answer this request.",
};
