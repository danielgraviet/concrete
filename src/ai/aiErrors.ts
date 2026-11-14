/**
 * Error helpers shared by AI callers. Duck-typed so `src/ai` doesn't import the
 * web backend (keeps the desktop bundle free of proxy code).
 */

export interface AiProxyErrorLike extends Error {
  name: 'AiProxyError';
  code: string;
  status: number;
  quota?: { used: number; limit: number; resetsAt: string };
}

/** True for an `AiProxyError` thrown by the web backend (quota, auth, rate limit, ...). */
export function isAiProxyError(error: unknown): error is AiProxyErrorLike {
  return (
    error instanceof Error &&
    error.name === 'AiProxyError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/** Text to show a user for a failed AI call: the error's own (friendly) message, else `fallback`. */
export function aiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
