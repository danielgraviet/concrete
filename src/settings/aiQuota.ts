import { aiErrorMessage, isAiProxyError } from '../ai/aiErrors';

export interface QuotaLike {
  used: number;
  /** -1 means unlimited. */
  limit: number;
  resetsAt: string;
}

/** "Dec 1" (UTC — resets land on a UTC month boundary), or null for an unparseable date. */
export function formatQuotaResetDate(resetsAt: string): string | null {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function isUnlimitedQuota(quota: QuotaLike): boolean {
  return quota.limit < 0;
}

/** "37 of 100 AI actions used this month · resets Dec 1", or "Unlimited · 5 AI actions used this month". */
export function formatQuotaUsage(quota: QuotaLike): string {
  const used = Math.max(0, Math.round(quota.used));
  const noun = used === 1 ? 'action' : 'actions';
  if (isUnlimitedQuota(quota)) return `Unlimited · ${used} AI ${noun} used this month`;
  const reset = formatQuotaResetDate(quota.resetsAt);
  const base = `${used} of ${quota.limit} AI actions used this month`;
  return reset ? `${base} · resets ${reset}` : base;
}

/** 0–100 for a progress bar; null when unlimited. */
export function quotaPercent(quota: QuotaLike): number | null {
  if (isUnlimitedQuota(quota)) return null;
  if (quota.limit === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((quota.used / quota.limit) * 100)));
}

/** Text for a failed quota fetch. Signed-out gets its own prompt rather than an error. */
export function quotaErrorText(error: unknown): string {
  if (isAiProxyError(error) && error.code === 'unauthorized') return 'Sign in to see your AI usage.';
  return `Couldn't load AI usage. ${aiErrorMessage(error, 'Try again later.')}`;
}
