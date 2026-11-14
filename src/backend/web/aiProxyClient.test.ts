import { describe, expect, it, vi } from 'vitest';
import { AiProxyClient, AiProxyError, SseParser, aiProxyErrorMessage, errorFromBody } from './aiProxyClient';

const QUOTA = { used: 3, limit: 100, resetsAt: '2026-12-01T00:00:00.000Z' };

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(fetchImpl: typeof fetch, token: string | null = 'tok-123') {
  return new AiProxyClient({ baseUrl: 'https://proxy.test/', getIdToken: async () => token, fetch: fetchImpl });
}

describe('SseParser', () => {
  it('reassembles an event split across chunks', () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"del')).toEqual([]);
    expect(p.push('ta","text":"hi"}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ type: 'delta', text: 'hi' }]);
  });

  it('returns multiple events from one chunk, ignoring comments and CRLF', () => {
    const p = new SseParser();
    const events = p.push(': ping\r\n\r\ndata: {"type":"delta","text":"a"}\r\n\r\ndata: {"type":"delta","text":"b"}\n\ndata: {"type":"do');
    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'delta', text: 'b' },
    ]);
    expect(p.push('ne","content":"ab"}\n\n')).toEqual([{ type: 'done', content: 'ab' }]);
  });

  it('parses error events and flushes a trailing unterminated event', () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"error","code":"upstream_error","message":"x"}')).toEqual([]);
    expect(p.end()).toEqual([{ type: 'error', code: 'upstream_error', message: 'x' }]);
  });

  it('splits a CRLF pair across chunks', () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"delta","text":"x"}\r\n\r')).toEqual([]);
    expect(p.push('\n')).toEqual([{ type: 'delta', text: 'x' }]);
  });
});

describe('error mapping', () => {
  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized', /Sign in/],
    [429, { error: 'quota_exceeded', ...QUOTA }, 'quota_exceeded', /used all 100 AI actions this month\. Resets December 1/],
    [429, { error: 'rate_limited' }, 'rate_limited', /Slow down/],
    [422, { error: 'refused' }, 'refused', /declined/],
    [413, { error: 'payload_too_large' }, 'payload_too_large', /too large/],
    [400, { error: 'bad_request', detail: 'bad roles' }, 'bad_request', /bad roles/],
    [502, { error: 'upstream_error' }, 'upstream_error', /problem/],
    [503, { error: 'upstream_rate_limited' }, 'upstream_rate_limited', /busy/],
    [500, { error: 'internal_error' }, 'internal_error', /internal/],
    [418, null, 'http_418', /418/],
  ])('%i %j -> %s', (status, body, code, message) => {
    const err = errorFromBody(status, body);
    expect(err).toBeInstanceOf(AiProxyError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(message);
  });

  it('keeps quota and detail on the error', () => {
    expect(errorFromBody(429, { error: 'quota_exceeded', ...QUOTA }).quota).toEqual(QUOTA);
    expect(errorFromBody(400, { error: 'bad_request', detail: 'd' }).detail).toBe('d');
  });

  it('has messages for client-side codes', () => {
    expect(aiProxyErrorMessage('network_error')).toMatch(/reach/);
    expect(aiProxyErrorMessage('aborted')).toMatch(/cancel/);
  });
});

describe('AiProxyClient', () => {
  it('sends the bearer token and returns the non-stream result', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { content: 'hello', model: 'm', usage: { in: 1 }, requestId: 'req_1', quota: QUOTA }),
    );
    const client = makeClient(fetchMock as typeof fetch);
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], operation: 'op' });

    expect(result).toEqual({ content: 'hello', model: 'm', usage: { in: 1 }, requestId: 'req_1', quota: QUOTA });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proxy.test/v1/chat');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(init!.body as string)).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      operation: 'op',
      stream: false,
    });
  });

  it('throws unauthorized without calling fetch when there is no token', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch, null);
    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      message: 'Sign in to use AI features.',
    });
    await expect(client.getQuota()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await client.hasToken()).toBe(false);
  });

  it('maps HTTP errors from the proxy', async () => {
    const client = makeClient((async () => jsonResponse(429, { error: 'quota_exceeded', ...QUOTA })) as typeof fetch);
    await expect(client.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'quota_exceeded',
      quota: QUOTA,
    });
  });

  it('maps network failures', async () => {
    const client = makeClient((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(client.getQuota()).rejects.toMatchObject({ code: 'network_error' });
  });

  it('streams deltas across chunk boundaries and resolves with the done event', async () => {
    const client = makeClient((async () =>
      sseResponse([
        'data: {"type":"delta","text":"Hel"}\n\ndata: {"type":"del',
        'ta","text":"lo"}\n',
        '\ndata: {"type":"done","content":"Hello","model":"m","usage":{},"requestId":"r","quota":',
        JSON.stringify(QUOTA) + '}\n\n',
      ])) as typeof fetch);
    const deltas: string[] = [];
    const result = await client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => deltas.push(t));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toMatchObject({ content: 'Hello', model: 'm', requestId: 'r', quota: QUOTA });
  });

  it('rejects on a stream error event', async () => {
    const client = makeClient((async () =>
      sseResponse(['data: {"type":"delta","text":"a"}\n\n', 'data: {"type":"error","code":"upstream_error","message":"x"}\n\n'])) as typeof fetch);
    const deltas: string[] = [];
    await expect(
      client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (t) => deltas.push(t)),
    ).rejects.toMatchObject({ code: 'upstream_error' });
    expect(deltas).toEqual(['a']);
  });

  it('rejects when the stream closes without done', async () => {
    const client = makeClient((async () => sseResponse(['data: {"type":"delta","text":"a"}\n\n'])) as typeof fetch);
    await expect(client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, () => {})).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('reads quota and health', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
      String(url).endsWith('/health') ? jsonResponse(200, { ok: true }) : jsonResponse(200, QUOTA),
    );
    const client = makeClient(fetchMock as typeof fetch, null);
    expect(await client.health()).toBe(true);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBeUndefined();
    const signedIn = makeClient(fetchMock as typeof fetch);
    expect(await signedIn.getQuota()).toEqual(QUOTA);
  });
});
