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

function webBackend(
  chatCompletions?: (...args: unknown[]) => unknown,
  recordActivity: AiBackend['recordActivity'] = async () => false,
): void {
  setBackendForTesting({
    target: 'web',
    capabilities: caps,
    ...(chatCompletions
      ? { ai: { chatCompletions, recordActivity } as unknown as AiBackend }
      : {}),
  });
}

afterEach(() => setBackendForTesting(null));

describe('ChatModelProvider on web', () => {
  it('labels the provider "OpenRouter · <model label>"', () => {
    webBackend(vi.fn());
    expect(new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH).label).toBe(
      'OpenRouter · DeepSeek V4 Flash',
    );
    expect(new ChatModelProvider('openrouter', 'openai/gpt-4o-mini').label).toBe('OpenRouter · GPT-4o mini');
    expect(new ChatModelProvider('openrouter').label).toBe('OpenRouter · GPT-5.6 Luna');
  });

  it('sends the selected model and Cerebras pinning to the proxy bridge', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'ok', model: 'qwen/qwen3.8-27b', usage: null });
    webBackend(chat);
    await new ChatModelProvider('openrouter', 'qwen/qwen3.8-27b').complete({
      prompt: 'p',
      provider: { order: ['Cerebras'], allow_fallbacks: true },
      reasoning: { enabled: false, effort: 'none' },
    });
    expect(chat.mock.calls[0][0]).toMatchObject({
      model: 'qwen/qwen3.8-27b',
      provider: { order: ['Cerebras'], allow_fallbacks: true },
      reasoning: { enabled: false, effort: 'none' },
    });
  });

  it('falls back to Luna on a quiz parse failure (non-proxy error)', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: 'not a quiz', model: OPENROUTER_MODEL_DEEPSEEK_V4_FLASH, usage: null })
      .mockResolvedValueOnce({ content: 'still not a quiz', model: 'openai/gpt-5.6-luna', usage: null });
    webBackend(chat);
    await expect(
      new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH).generateQuiz({ topic: 'Cells' }),
    ).rejects.toThrow(/Luna fallback also failed/);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0]).toMatchObject({ model: 'openai/gpt-5.6-luna', operation: 'quiz_generation_fallback' });
  });

  it('does not fall back after an out-of-credits proxy error', async () => {
    const chat = vi.fn().mockRejectedValue(new AiProxyError('upstream_out_of_credits', 503));
    webBackend(chat);
    await expect(
      new ChatModelProvider('openrouter', OPENROUTER_MODEL_DEEPSEEK_V4_FLASH).generateQuiz({ topic: 'Cells' }),
    ).rejects.toThrow(/temporarily unavailable/);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('keeps desktop labels on desktop', () => {
    setBackendForTesting({ target: 'desktop', capabilities: caps });
    expect(new ChatModelProvider('codex').label).toBe('Codex');
  });

  it('says AI is not configured when the proxy URL is missing', async () => {
    webBackend();
    await expect(new ChatModelProvider('openrouter').complete({ prompt: 'hi' })).rejects.toThrow(
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
    webBackend(vi.fn().mockResolvedValue({ content: 'not a quiz', model: 'openai/gpt-4o-mini', usage: null }));
    const error = await new ChatModelProvider('openrouter', 'openai/gpt-4o-mini')
      .generateQuiz({ topic: 'Cells' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('AI Activity');
  });

  it('includes the AI Activity hint when saving the raw reply succeeds', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'not a quiz', model: 'openai/gpt-4o-mini', usage: null });
    const save = vi.fn().mockResolvedValue(true);
    webBackend(chat, save);
    await expect(new ChatModelProvider('openrouter', 'openai/gpt-4o-mini').generateQuiz({ topic: 'Cells' }))
      .rejects.toThrow('saved under Settings → AI Activity');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'quiz_parse_failure',
      responseText: 'not a quiz',
    }));
  });

  it('preserves the parse error when saving AI Activity fails', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'not a quiz', model: 'openai/gpt-4o-mini', usage: null });
    webBackend(chat, vi.fn().mockRejectedValue(new Error('Storage unavailable')));
    await expect(new ChatModelProvider('openrouter', 'openai/gpt-4o-mini').generateQuiz({ topic: 'Cells' }))
      .rejects.toThrow(/^Model response did not contain parseable quiz questions\. Try again\.$/);
  });
});
