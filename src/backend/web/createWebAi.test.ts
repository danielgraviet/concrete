import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProxyClient } from './aiProxyClient';
import { createWebAi, toProxyRequest } from './createWebAi';
import { createWebBackend, getWebIdToken, setWebIdTokenSource } from './index';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A stream that emits the given SSE chunks, then stays open until aborted. */
function controllableSse(signal: AbortSignal | undefined | null, chunks: string[], close = true): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (close) controller.close();
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });
  return new Response(body, { status: 200 });
}

function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, token: string | null = 'tok') {
  const fetchMock = vi.fn(fetchImpl);
  const client = new AiProxyClient({
    baseUrl: 'https://proxy.test',
    getIdToken: async () => token,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { ai: createWebAi(client), fetchMock };
}

afterEach(() => setWebIdTokenSource(null));

describe('toProxyRequest', () => {
  it('drops backend/model/temperature/provider/reasoning/capture and keeps the rest', () => {
    expect(
      toProxyRequest({
        backend: 'openrouter',
        model: 'x/y',
        temperature: 0.4,
        provider: { order: ['a'] },
        reasoning: { enabled: false },
        capture: 'full',
        max_tokens: 100,
        operation: 'quiz_generation',
        metadata: { topic: 't' },
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'u' },
        ],
      }),
    ).toEqual({
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      max_tokens: 100,
      operation: 'quiz_generation',
      metadata: { topic: 't' },
    });
  });

  it('throws a clear error for a trailing assistant turn', () => {
    expect(() =>
      toProxyRequest({
        messages: [
          { role: 'user', content: 'u' },
          { role: 'assistant', content: 'prefill' },
        ],
      }),
    ).toThrow(/must end with a user message/);
  });
});

describe('createWebAi', () => {
  it('routes chatCompletions to /v1/chat', async () => {
    const { ai, fetchMock } = setup(async () =>
      jsonResponse(200, { content: 'ok', model: 'claude-haiku', usage: {}, requestId: 'r1', quota: { used: 1, limit: 5, resetsAt: 'x' } }),
    );
    const result = await ai.chatCompletions({ backend: 'claude', model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toEqual({ content: 'ok', model: 'claude-haiku', usage: {}, requestId: 'r1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ messages: [{ role: 'user', content: 'hi' }], stream: false });
  });

  it('delivers stream deltas to onChatDelta listeners tagged with the streamId', async () => {
    const { ai } = setup(async (_url, init) =>
      controllableSse(init.signal, [
        'data: {"type":"delta","text":"A"}\n\n',
        'data: {"type":"delta","text":"B"}\n\ndata: {"type":"done","content":"AB","model":"m","usage":{}}\n\n',
      ]),
    );
    const events: AiChatDeltaEvent[] = [];
    const stop = ai.onChatDelta!((e) => events.push(e));
    const result = await ai.chatStream!({ streamId: 's1', messages: [{ role: 'user', content: 'hi' }] });
    stop();
    expect(result.content).toBe('AB');
    expect(events).toEqual([
      { streamId: 's1', text: 'A' },
      { streamId: 's1', text: 'B' },
    ]);
    // Unsubscribed listeners get nothing more; cancel of a finished stream is a no-op.
    expect(await ai.chatCancel!('s1')).toBe(false);
  });

  it('chatCancel aborts the in-flight stream', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const { ai } = setup(async (_url, init) => {
      seenSignal = init.signal;
      return controllableSse(init.signal, ['data: {"type":"delta","text":"A"}\n\n'], false);
    });
    const events: AiChatDeltaEvent[] = [];
    ai.onChatDelta!((e) => events.push(e));
    const pending = ai.chatStream!({ streamId: 's2', messages: [{ role: 'user', content: 'hi' }] });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(await ai.chatCancel!('s2')).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('reports status from the token source', async () => {
    expect(await setup(async () => jsonResponse(200, {}), 'tok').ai.status()).toMatchObject({
      configured: true,
      provider: 'claude',
      model: 'Concrete AI',
    });
    expect(await setup(async () => jsonResponse(200, {}), null).ai.status()).toMatchObject({
      configured: false,
      message: 'Sign in to use AI features.',
    });
  });

  it('stubs desktop-only methods', async () => {
    const { ai, fetchMock } = setup(async () => jsonResponse(200, { ok: true }));
    await expect(ai.setApiKey('k')).rejects.toThrow('Not available on web');
    await expect(ai.agentRun({ vaultRoot: '/', prompt: 'p' })).rejects.toThrow('Not available on web');
    expect(await ai.agentCancel()).toBe(false);
    expect(await ai.agentStatus()).toMatchObject({ available: false, authenticated: false });
    expect(await ai.activity()).toEqual([]);
    expect(await ai.trajectories()).toEqual([]);
    expect(await ai.telemetry()).toEqual([]);
    expect(await ai.recordActivity({ operation: 'x' })).toBe(false);
    expect(typeof ai.onAgentProgress(() => {})).toBe('function');
    expect(typeof ai.onSetTheme(() => {})).toBe('function');
    expect(await ai.ping()).toMatchObject({ ok: true, model: 'Concrete AI' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.test/health');
  });
});

describe('web backend wiring', () => {
  it('defaults to signed out and accepts a token source', async () => {
    expect(await getWebIdToken()).toBeNull();
    setWebIdTokenSource(async () => 'abc');
    expect(await getWebIdToken()).toBe('abc');
    setWebIdTokenSource(null);
    expect(await getWebIdToken()).toBeNull();
  });

  it('keeps every capability off and the vault undefined', () => {
    const backend = createWebBackend();
    expect(backend.target).toBe('web');
    expect(backend.vault).toBeUndefined();
    expect(Object.values(backend.capabilities).every((v) => v === false)).toBe(true);
  });

  it('adds ai only when VITE_AI_PROXY_URL is set, using the injected token source', async () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '');
    expect(createWebBackend().ai).toBeUndefined();
    vi.stubEnv('VITE_AI_PROXY_URL', 'https://proxy.test');
    const fetchMock = vi.fn(async () => jsonResponse(200, { content: 'ok', model: 'm', usage: {} }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { ai } = createWebBackend();
      expect(ai).toBeDefined();
      await expect(ai!.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
        code: 'unauthorized',
      });
      expect(fetchMock).not.toHaveBeenCalled();
      setWebIdTokenSource(async () => 'live-token');
      await ai!.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer live-token');
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});
