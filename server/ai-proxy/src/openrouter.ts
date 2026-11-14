import type { ChatMessage, ProviderPrefs, ReasoningPrefs } from "./messages";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** How long to wait for response headers, and then between stream chunks, before giving up. */
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export interface OpenRouterBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  provider?: ProviderPrefs;
  reasoning?: ReasoningPrefs;
  stream: true;
  usage: { include: true };
}

/** How the Worker reaches OpenRouter (tests inject a fake `fetch`). */
export interface Upstream {
  apiKey: string;
  /** `HTTP-Referer` attribution; omitted when empty. */
  appUrl: string;
  fetch: typeof fetch;
  idleTimeoutMs?: number;
}

/** Usage object as OpenRouter reports it (token counts plus `cost` in USD credits). */
export type OpenRouterUsage = Record<string, unknown> & { cost?: unknown };

/** One parsed `data:` payload from OpenRouter's OpenAI-style stream. */
export interface OpenRouterChunk {
  id?: string;
  model?: string;
  choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: OpenRouterUsage;
  error?: { code?: unknown; message?: unknown; metadata?: unknown };
}

export type FailureKind = "http" | "stream" | "timeout" | "network";

/**
 * Upstream failure. Carries only the status and whether moderation flagged the
 * input; the raw upstream body is never kept, so it can't leak to clients.
 */
export class UpstreamFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status: number | undefined,
    readonly flagged = false,
  ) {
    super(`openrouter ${kind}${status !== undefined ? ` ${status}` : ""}${flagged ? " (flagged)" : ""}`);
    this.name = "UpstreamFailure";
  }
}

function looksFlagged(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  const meta = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>) : {};
  if (Array.isArray(meta.reasons) && meta.reasons.length > 0) return true;
  if (meta.flagged_input !== undefined) return true;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return message.includes("flagged") || message.includes("moderation");
}

/** Builds an UpstreamFailure from a non-2xx status and its (parsed) JSON body, if any. */
export function failureFromHttp(status: number, body: unknown): UpstreamFailure {
  const error = body && typeof body === "object" ? (body as Record<string, unknown>).error : undefined;
  return new UpstreamFailure("http", status, status === 403 && looksFlagged(error));
}

/** Builds an UpstreamFailure from an `error` object sent inside a 200 stream. */
export function failureFromStreamError(error: OpenRouterChunk["error"]): UpstreamFailure {
  const code = typeof error?.code === "number" ? error.code : Number(error?.code);
  const status = Number.isFinite(code) && code >= 100 && code < 600 ? code : undefined;
  return new UpstreamFailure("stream", status, looksFlagged(error));
}

/**
 * Incremental parser for OpenRouter's SSE stream. Feed decoded text; get the
 * JSON payloads of complete `data:` events back. Handles events split across
 * chunks, CRLF line endings, comment lines (`: OPENROUTER PROCESSING`),
 * multi-line data fields and the `[DONE]` sentinel (reported via `done`).
 */
export class OpenRouterSseParser {
  private buffer = "";
  private data: string[] = [];
  done = false;

  push(text: string): OpenRouterChunk[] {
    this.buffer += text;
    const out: OpenRouterChunk[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.line(line, out);
    }
    return out;
  }

  /** Flushes a final event that wasn't followed by a blank line. */
  end(): OpenRouterChunk[] {
    const out: OpenRouterChunk[] = [];
    if (this.buffer) {
      const rest = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = "";
      this.line(rest, out);
    }
    this.dispatch(out);
    return out;
  }

  private line(line: string, out: OpenRouterChunk[]): void {
    if (line === "") {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      this.data.push(line.slice(5).replace(/^ /, ""));
    }
    // Other fields (event:, id:, retry:) are not used by OpenRouter.
  }

  private dispatch(out: OpenRouterChunk[]): void {
    if (this.data.length === 0) return;
    const payload = this.data.join("\n").trim();
    this.data = [];
    if (payload === "[DONE]") {
      this.done = true;
      return;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed as OpenRouterChunk);
    } catch {
      /* ignore malformed payloads */
    }
  }
}

export interface UpstreamStream {
  /** Parsed chunks in order; throws UpstreamFailure on timeout / transport errors. */
  chunks: AsyncIterator<OpenRouterChunk>;
  /** Stops the upstream request (client went away). */
  abort(): void;
}

/**
 * Opens a streaming chat completion. Resolves once response headers arrive;
 * a non-2xx status rejects with UpstreamFailure (body read, never forwarded).
 */
export async function openStream(up: Upstream, body: OpenRouterBody): Promise<UpstreamStream> {
  const idleMs = up.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleMs);
  };
  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${up.apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Concrete",
  };
  if (up.appUrl) headers["HTTP-Referer"] = up.appUrl;

  arm();
  let res: Response;
  try {
    res = await up.fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    disarm();
    throw new UpstreamFailure(timedOut ? "timeout" : "network", undefined);
  }

  if (!res.ok || !res.body) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      /* non-JSON error body */
    }
    disarm();
    throw failureFromHttp(res.ok ? 502 : res.status, parsed);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new OpenRouterSseParser();

  async function* iterate(): AsyncGenerator<OpenRouterChunk> {
    try {
      for (;;) {
        arm();
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch {
          throw new UpstreamFailure(timedOut ? "timeout" : "network", undefined);
        }
        const chunks = r.done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(r.value, { stream: true }));
        for (const c of chunks) yield c;
        if (r.done || parser.done) return;
      }
    } finally {
      disarm();
      reader.cancel().catch(() => {});
    }
  }

  return {
    chunks: iterate(),
    abort: () => {
      disarm();
      controller.abort();
    },
  };
}

/** Accumulates a completion from stream chunks. */
export class Completion {
  content = "";
  model: string;
  id: string | undefined;
  usage: OpenRouterUsage | null = null;
  finishReason: string | null = null;

  constructor(requestedModel: string) {
    this.model = requestedModel;
  }

  /** Applies one chunk; returns its text delta (possibly ""). Throws UpstreamFailure on an `error` chunk. */
  apply(chunk: OpenRouterChunk): string {
    if (chunk.error) throw failureFromStreamError(chunk.error);
    if (typeof chunk.id === "string" && chunk.id) this.id = chunk.id;
    if (typeof chunk.model === "string" && chunk.model) this.model = chunk.model;
    if (chunk.usage && typeof chunk.usage === "object") this.usage = chunk.usage;
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    if (choice?.finish_reason === "error") throw new UpstreamFailure("stream", undefined);
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta) {
      this.content += delta;
      return delta;
    }
    return "";
  }

  /** USD cost reported by OpenRouter, or 0. */
  get cost(): number {
    const c = Number(this.usage?.cost);
    return Number.isFinite(c) && c > 0 ? c : 0;
  }

  get refused(): boolean {
    return this.finishReason === "content_filter";
  }
}
