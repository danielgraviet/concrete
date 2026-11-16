import { describe, expect, it } from 'vitest';
import { AiProxyError } from '../backend/web';
import { formatQuotaResetDate, formatQuotaUsage, quotaErrorText, quotaPercent } from './aiQuota';

const DEC_1 = '2026-12-01T00:00:00.000Z';

describe('formatQuotaUsage', () => {
  it('shows used of limit with the reset date', () => {
    expect(formatQuotaUsage({ used: 37, limit: 100, resetsAt: DEC_1 })).toBe(
      '37 of 100 AI actions used this month · resets Dec 1',
    );
  });

  it('formats the reset date in UTC (a first-of-month reset never shows as the 30th)', () => {
    expect(formatQuotaResetDate(DEC_1)).toBe('Dec 1');
    expect(formatQuotaResetDate('2027-01-01T00:00:00Z')).toBe('Jan 1');
  });

  it('drops the reset date when it does not parse', () => {
    expect(formatQuotaUsage({ used: 0, limit: 100, resetsAt: 'soon' })).toBe('0 of 100 AI actions used this month');
    expect(formatQuotaResetDate('soon')).toBeNull();
  });

  it('shows Unlimited for limit -1', () => {
    expect(formatQuotaUsage({ used: 5, limit: -1, resetsAt: DEC_1 })).toBe('Unlimited · 5 AI actions used this month');
    expect(formatQuotaUsage({ used: 1, limit: -1, resetsAt: DEC_1 })).toBe('Unlimited · 1 AI action used this month');
  });
});

describe('quotaPercent', () => {
  it('is clamped 0–100 and null when unlimited', () => {
    expect(quotaPercent({ used: 37, limit: 100, resetsAt: DEC_1 })).toBe(37);
    expect(quotaPercent({ used: 120, limit: 100, resetsAt: DEC_1 })).toBe(100);
    expect(quotaPercent({ used: 0, limit: 0, resetsAt: DEC_1 })).toBe(100);
    expect(quotaPercent({ used: 3, limit: -1, resetsAt: DEC_1 })).toBeNull();
  });
});

describe('quotaErrorText', () => {
  it('asks signed-out users to sign in', () => {
    expect(quotaErrorText(new AiProxyError('unauthorized', 401))).toBe('Sign in to see your AI usage.');
  });

  it('uses the proxy error message otherwise', () => {
    expect(quotaErrorText(new AiProxyError('network_error', 0))).toBe(
      "Couldn't load AI usage. Couldn't reach the AI service. Check your connection.",
    );
    expect(quotaErrorText(null)).toBe("Couldn't load AI usage. Try again later.");
  });
});
