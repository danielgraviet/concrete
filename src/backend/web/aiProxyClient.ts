/**
 * Typed client for the Concrete AI proxy Worker (`server/ai-proxy`).
 * Auth is injected (`getIdToken`) so this module has no Firebase dependency.
 */

export interface AiProxyMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProxyChatRequest {
  messages: AiProxyMessage[];
  max_tokens?: number;
  operation?: string;
  metadata?: Record<string, unknown>;
}

export interface AiProxyQuota {
  used: number;
  /** -1 means unlimited. */
  limit: number;
  resetsAt: string;
}

export interface AiProxyChatResult {
  content: string;
  model: string;
  usage: unknown;
  requestId?: string;
  quota?: AiProxyQuota;
}

export type AiProxyErrorCode =
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'refused'
  | 'payload_too_large'
  | 'bad_request'
  | 'upstream_error'
  | 'upstream_rate_limited'
  | 'internal_error'
  | 'network_error'
  | 'aborted'
  | 'bad_response'
  | (string & {});

function formatResetDate(resetsAt: string): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return 'next month';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** User-facing text for a proxy error code. */
export function aiProxyErrorMessage(
  code: AiProxyErrorCode,
  extra: { quota?: AiProxyQuota; detail?: string; status?: number } = {},
): string {
  switch (code) {
    case 'unauthorized':
      return 'Sign in to use AI features.';
    case 'quota_exceeded': {
      const q = extra.quota;
      return q
        ? `You've used all ${q.limit} AI actions this month. Resets ${formatResetDate(q.resetsAt)}.`
        : "You've used all your AI actions this month.";
    }
    case 'rate_limited':
      return 'Slow down a moment — too many AI requests at once. Try again in a few seconds.';
    case 'refused':
      return 'The AI declined to answer this request.';
    case 'payload_too_large':
      return 'This request is too large for the AI. Try a shorter note or fewer sources.';
    case 'bad_request':
      return `The AI request was invalid${extra.detail ? `: ${extra.detail}` : '.'}`;
    case 'upstream_rate_limited':
      return 'The AI service is busy right now. Try again in a minute.';
    case 'upstream_error':
      return 'The AI service had a problem. Try again shortly.';
    case 'internal_error':
      return 'The AI proxy hit an internal error. Try again shortly.';
    case 'network_error':
      return "Couldn't reach the AI service. Check your connection.";
    case 'aborted':
      return 'AI request cancelled.';
    case 'bad_response':
      return 'The AI service returned an unexpected response.';
    default:
      return `AI request failed${extra.status ? ` (${extra.status})` : ''}.`;
  }
}

export class AiProxyError extends Error {
  readonly code: AiProxyErrorCode;
  readonly status: number;
  readonly quota?: AiProxyQuota;
  readonly detail?: string;

  constructor(code: AiProxyErrorCode, status: number, opts: { quota?: AiProxyQuota; detail?: string; message?: string } = {}) {
    super(opts.message ?? aiProxyErrorMessage(code, { quota: opts.quota, detail: opts.detail, status }));
    this.name = 'AiProxyError';
    this.code = code;
    this.status = status;
    this.quota = opts.quota;
    this.detail = opts.detail;
  }
}

function asQuota(value: unknown): AiProxyQuota | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.used !== 'number' || typeof v.limit !== 'number' || typeof v.resetsAt !== 'string') return undefined;
  return { used: v.used, limit: v.limit, resetsAt: v.resetsAt };
}

/** Build an AiProxyError from a non-2xx JSON body (or anything unparseable). */
export function errorFromBody(status: number, body: unknown): AiProxyError {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof b.error === 'string' ? b.error : status === 401 ? 'unauthorized' : `http_${status}`;
  const detail = typeof b.detail === 'string' ? b.detail : undefined;
  return new AiProxyError(code, status, { quota: code === 'quota_exceeded' ? asQuota(b) : undefined, detail });
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Incremental SSE parser: feed arbitrary text chunks, get complete `data:`
 * events back. Handles events split across chunks, several events per chunk,
 * CRLF line endings, comments and multi-line data fields.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    // Normalise line endings, then split on blank lines (event boundaries).
    // A trailing '\r' may be half of a CRLF split across chunks: hold it back.
    const heldCr = this.buffer.endsWith('\r');
    if (heldCr) this.buffer = this.buffer.slice(0, -1);
    this.buffer = this.buffer.replace(/\r\n?/g, '\n');
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = parseBlock(block);
      if (event) events.push(event);
      boundary = this.buffer.indexOf('\n\n');
    }
    if (heldCr) this.buffer += '\r';
    return events;
  }

  /** Flush a trailing event that wasn't followed by a blank line. */
  end(): SseEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    const event = rest.trim() ? parseBlock(rest) : null;
    return event ? [event] : [];
  }
}

function parseBlock(block: string): SseEvent | null {
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    const parsed = JSON.parse(data.join('\n')) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as SseEvent).type === 'string') {
      return parsed as SseEvent;
    }
  } catch {
    /* ignore malformed event */
  }
  return null;
}

export interface AiProxyClientOptions {
  baseUrl: string;
  getIdToken: () => Promise<string | null>;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export type ProxyRequestInit = RequestInit & {
  auth?: boolean;
  /** Turns a non-2xx status + parsed JSON body (or null) into the error to throw. */
  errorFromBody?: (status: number, body: unknown) => Error;
  /** Builds transport errors (unauthorized, network_error, aborted). */
  makeError?: (code: AiProxyErrorCode, status: number, detail?: string) => Error;
};

export type ProxyRequest = (path: string, init: ProxyRequestInit) => Promise<Response>;

/**
 * Authenticated fetch against the proxy Worker: injects the bearer token,
 * maps network/abort failures and non-2xx bodies to typed errors. Shared by
 * the AI client and the files client.
 */
export function createProxyRequest(options: AiProxyClientOptions): ProxyRequest {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const getIdToken = options.getIdToken;
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  return async (path, init) => {
    const { auth, errorFromBody: fromBody = errorFromBody, makeError, ...rest } = init;
    const fail = makeError ?? ((code, status, detail) => new AiProxyError(code, status, { detail }));
    const headers: Record<string, string> = { ...(rest.headers as Record<string, string> | undefined) };
    if (auth !== false) {
      const token = await getIdToken().catch(() => null);
      if (!token) throw fail('unauthorized', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { ...rest, headers });
    } catch (err) {
      if (isAbort(err) || rest.signal?.aborted) throw fail('aborted', 0);
      throw fail('network_error', 0, err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw fromBody(res.status, body);
    }
    return res;
  };
}

export class AiProxyClient {
  private readonly getIdToken: () => Promise<string | null>;
  private readonly request: ProxyRequest;

  constructor(options: AiProxyClientOptions) {
    this.getIdToken = options.getIdToken;
    this.request = createProxyRequest(options);
  }

  /** True when a token source currently yields a token (i.e. a user is signed in). */
  async hasToken(): Promise<boolean> {
    try {
      return Boolean(await this.getIdToken());
    } catch {
      return false;
    }
  }

  async chat(req: AiProxyChatRequest, opts: { signal?: AbortSignal } = {}): Promise<AiProxyChatResult> {
    const res = await this.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req, stream: false }),
      signal: opts.signal,
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.content !== 'string') throw new AiProxyError('bad_response', res.status);
    return resultFrom(body);
  }

  async chatStream(
    req: AiProxyChatRequest,
    onDelta: (text: string) => void,
    opts: { signal?: AbortSignal } = {},
  ): Promise<AiProxyChatResult> {
    const res = await this.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ ...req, stream: true }),
      signal: opts.signal,
    });
    if (!res.body) throw new AiProxyError('bad_response', res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let streamed = '';

    const handle = (event: SseEvent): AiProxyChatResult | null => {
      if (event.type === 'delta' && typeof event.text === 'string') {
        streamed += event.text;
        onDelta(event.text);
      } else if (event.type === 'done') {
        return resultFrom({ ...event, content: typeof event.content === 'string' ? event.content : streamed });
      } else if (event.type === 'error') {
        const code = typeof event.code === 'string' ? event.code : 'upstream_error';
        throw new AiProxyError(code, res.status);
      }
      return null;
    };

    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (isAbort(err) || opts.signal?.aborted) throw new AiProxyError('aborted', 0);
          throw new AiProxyError('network_error', 0, { detail: err instanceof Error ? err.message : String(err) });
        }
        const events = chunk.done
          ? [...parser.push(decoder.decode()), ...parser.end()]
          : parser.push(decoder.decode(chunk.value, { stream: true }));
        for (const event of events) {
          const done = handle(event);
          if (done) return done;
        }
        if (chunk.done) break;
      }
    } finally {
      // Close the connection if we stopped early (done/error event, or a throw).
      reader.cancel().catch(() => {});
    }
    if (opts.signal?.aborted) throw new AiProxyError('aborted', 0);
    throw new AiProxyError('bad_response', res.status, { message: 'The AI stream ended unexpectedly.' });
  }

  async getQuota(opts: { signal?: AbortSignal } = {}): Promise<AiProxyQuota> {
    const res = await this.request('/v1/quota', { method: 'GET', signal: opts.signal });
    const quota = asQuota(await res.json().catch(() => null));
    if (!quota) throw new AiProxyError('bad_response', res.status);
    return quota;
  }

  async health(opts: { signal?: AbortSignal } = {}): Promise<boolean> {
    const res = await this.request('/health', { method: 'GET', signal: opts.signal, auth: false });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  }
}

function resultFrom(body: Record<string, unknown>): AiProxyChatResult {
  return {
    content: String(body.content ?? ''),
    model: typeof body.model === 'string' ? body.model : 'Concrete AI',
    usage: body.usage ?? null,
    ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}),
    ...(asQuota(body.quota) ? { quota: asQuota(body.quota) } : {}),
  };
}
