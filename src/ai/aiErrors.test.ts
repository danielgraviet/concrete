import { describe, expect, it } from 'vitest';
import { AiProxyError } from '../backend/web';
import { aiErrorMessage, isAiProxyError } from './aiErrors';

describe('isAiProxyError', () => {
  it('recognises proxy errors and nothing else', () => {
    expect(isAiProxyError(new AiProxyError('quota_exceeded', 429))).toBe(true);
    expect(isAiProxyError(new Error('boom'))).toBe(false);
    expect(isAiProxyError({ name: 'AiProxyError', code: 'x' })).toBe(false);
  });
});

describe('aiErrorMessage', () => {
  it('keeps the friendly proxy message', () => {
    const quota = { used: 100, limit: 100, resetsAt: '2026-12-01T00:00:00Z' };
    expect(aiErrorMessage(new AiProxyError('quota_exceeded', 429, { quota }), 'Quiz generation failed')).toBe(
      "You've used all 100 AI actions this month. Resets December 1.",
    );
    expect(aiErrorMessage(new AiProxyError('unauthorized', 401), 'x')).toBe('Sign in to use AI features.');
  });

  it('falls back for empty or non-error values', () => {
    expect(aiErrorMessage(new Error(''), 'Fallback')).toBe('Fallback');
    expect(aiErrorMessage(undefined, 'Fallback')).toBe('Fallback');
    expect(aiErrorMessage('plain', 'Fallback')).toBe('plain');
  });
});
