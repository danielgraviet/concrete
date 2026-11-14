import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBackendForTesting, type AiBackend, type Backend } from '../backend';
import { AiProxyError } from '../backend/web';
import { ChatModelProvider, OPENROUTER_MODEL_DEEPSEEK_V4_FLASH } from './ChatModelProvider';

const caps: Backend['capabilities'] = {
  localAgents: false,
  revealInFolder: false,
  openWithOsApp: false,
  diskImport: false,
  fileImport: false,
  nativePdfExport: false,
  localTelemetry: false,
  sandbox: false,
  apiKeySettings: false,
};

function webBackend(chatCompletions?: (...args: unknown[]) => unknown): void {
  setBackendForTesting({
    target: 'web',
    capabilities: caps,
    ...(chatCompletions
      ? { ai: { chatCompletions, recordActivity: async () => false } as unknown as AiBackend }
      : {}),
  });
}

afterEach(() => setBackendForTesting(null));

describe('ChatModelProvider on web', () => {
  it('labels every backend Concrete AI', () => {
    webBackend(vi.fn());
    expect(new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH).label).toBe('Concrete AI');
    expect(new ChatModelProvider('claude', 'sonnet').label).toBe('Concrete AI');
  });

  it('keeps desktop labels on desktop', () => {
    setBackendForTesting({ target: 'desktop', capabilities: caps });
    expect(new ChatModelProvider('codex').label).toBe('Codex');
  });

  it('says AI is not configured when the proxy URL is missing', async () => {
    webBackend();
    await expect(new ChatModelProvider('claude').complete({ prompt: 'hi' })).rejects.toThrow(
      "AI isn't configured for this site yet.",
    );
  });

  it('surfaces a quota error from quiz generation without a fallback call', async () => {
    const quota = { used: 100, limit: 100, resetsAt: '2026-12-01T00:00:00Z' };
    const chat = vi.fn().mockRejectedValue(new AiProxyError('quota_exceeded', 429, { quota }));
    webBackend(chat);
    const provider = new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH);
    await expect(provider.generateQuiz({ topic: 'Cells' })).rejects.toThrow(
      "You've used all 100 AI actions this month.",
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('surfaces sign-in and rate-limit errors from grading unchanged', async () => {
    for (const err of [new AiProxyError('unauthorized', 401), new AiProxyError('rate_limited', 429)]) {
      const chat = vi.fn().mockRejectedValue(err);
      webBackend(chat);
      const provider = new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH);
      await expect(
        provider.gradeQuiz({
          quiz: { title: 'Q', questions: [{ id: 'q1', type: 'open', prompt: 'Why?', answer: 'Because' }] },
          responses: [{ questionId: 'q1', type: 'open', text: 'Reasons' }],
        } as never),
      ).rejects.toBe(err);
      expect(chat).toHaveBeenCalledTimes(1);
    }
  });

  it('omits the AI Activity hint on a parse failure', async () => {
    webBackend(vi.fn().mockResolvedValue({ content: 'not a quiz', model: 'Concrete AI', usage: null }));
    const error = await new ChatModelProvider('claude').generateQuiz({ topic: 'Cells' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('AI Activity');
  });
});
