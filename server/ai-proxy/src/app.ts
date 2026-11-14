import type Anthropic from "@anthropic-ai/sdk";
import { AuthError, bearerToken, type TokenVerifier } from "./auth";
import { BurstLimiter } from "./burst";
import type { Config } from "./config";
import { corsHeaders, preflight } from "./cors";
import { mapUpstreamError, REFUSED, type MappedError } from "./errors";
import { filesRouteMethods, handleFiles, type FilesDeps } from "./files";
import { json, type Cors } from "./http";
import { BadRequest, clampMaxTokens, parseChatRequest, splitMessages } from "./messages";
import { periodFor, resetsAtFor, UNLIMITED, type QuotaInfo, type QuotaStore } from "./quota";

export const MAX_BODY_BYTES = 400 * 1024;

/** The subset of the SDK's MessageStream the proxy relies on (lets tests inject fakes). */
export interface ModelStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
  readonly request_id?: string | null;
  abort?(): void;
}

export interface ModelClient {
  stream(params: Anthropic.MessageStreamParams): ModelStream;
}

export interface Deps {
  config: Config;
  verifyToken: TokenVerifier;
  quota: QuotaStore;
  model: ModelClient;
  /** R2 bucket + storage accounting for `/v1/files`; absent when the FILES binding is missing. */
  files?: FilesDeps;
  burst?: BurstLimiter;
  now?: () => Date;
  waitUntil?: (p: Promise<unknown>) => void;
  log?: (entry: Record<string, unknown>) => void;
}

function errorJson(err: MappedError, cors: Cors): Response {
  return json(err.status, { error: err.code, message: err.message }, cors);
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const { config } = deps;
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, config.allowedOrigins);
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return preflight(req, config.allowedOrigins);

  try {
    if (url.pathname === "/health") {
      return req.method === "GET" ? json(200, { ok: true }, cors) : json(405, { error: "method_not_allowed" }, cors);
    }

    const fileMethods = filesRouteMethods(url.pathname);
    const route =
      url.pathname === "/v1/chat" ? "chat" : url.pathname === "/v1/quota" ? "quota" : fileMethods ? "files" : null;
    if (!route) return json(404, { error: "not_found" }, cors);
    if (
      (route === "chat" && req.method !== "POST") ||
      (route === "quota" && req.method !== "GET") ||
      (route === "files" && !fileMethods!.includes(req.method))
    ) {
      return json(405, { error: "method_not_allowed" }, cors);
    }

    const token = bearerToken(req);
    if (!token) return json(401, { error: "unauthorized" }, cors);
    let uid: string;
    try {
      ({ uid } = await deps.verifyToken(token));
    } catch (err) {
      if (err instanceof AuthError) return json(401, { error: "unauthorized" }, cors);
      throw err;
    }

    // File routes never touch the AI quota or burst limiter.
    if (route === "files") {
      if (!deps.files) return json(503, { error: "files_unavailable" }, cors);
      return await handleFiles(req, url, { uid, config, files: deps.files, cors });
    }

    const now = deps.now?.() ?? new Date();
    const period = periodFor(now);
    const resetsAt = resetsAtFor(now);
    const unlimited = config.allowlist.has(uid);
    const limit = unlimited ? UNLIMITED : config.quotaMonthly;

    if (route === "quota") {
      const used = await deps.quota.getUsed(uid, period);
      return json(200, { used, limit, resetsAt } satisfies QuotaInfo, cors);
    }

    return await handleChat(req, deps, cors, { uid, period, resetsAt, unlimited, limit });
  } catch (err) {
    deps.log?.({ level: "error", event: "unhandled", error: String(err) });
    return json(500, { error: "internal_error" }, cors);
  }
}

interface Caller {
  uid: string;
  period: string;
  resetsAt: string;
  unlimited: boolean;
  limit: number;
}

async function handleChat(req: Request, deps: Deps, cors: Cors, caller: Caller): Promise<Response> {
  const { config } = deps;
  const log = deps.log ?? (() => {});

  // --- body ---
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" }, cors);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" }, cors);
  }

  let parsed;
  let split;
  try {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new BadRequest("body is not valid JSON");
    }
    parsed = parseChatRequest(body);
    split = splitMessages(parsed.messages);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: "bad_request", detail: err.message }, cors);
    throw err;
  }

  if (parsed.model !== undefined && parsed.model !== config.model) {
    log({ level: "info", event: "client_model_ignored", uid: caller.uid, requested: parsed.model, using: config.model });
  }

  // --- burst + quota (both before any model call) ---
  const release = deps.burst ? deps.burst.acquire(caller.uid) : () => {};
  if (!release) return json(429, { error: "rate_limited" }, cors);
  let releaseInStream = false;
  try {
    const reservation = await deps.quota.reserve(
      caller.uid,
      caller.period,
      caller.unlimited ? null : config.quotaMonthly,
    );
    if (!reservation.ok) {
      return json(
        429,
        { error: "quota_exceeded", used: reservation.used, limit: caller.limit, resetsAt: caller.resetsAt },
        cors,
      );
    }
    const quota: QuotaInfo = { used: reservation.used, limit: caller.limit, resetsAt: caller.resetsAt };
    let refunded = false;
    const refund = async () => {
      if (refunded) return;
      refunded = true;
      try {
        await deps.quota.refund(caller.uid, caller.period);
      } catch (err) {
        log({ level: "error", event: "refund_failed", uid: caller.uid, error: String(err) });
      }
    };

    const params: Anthropic.MessageStreamParams = {
      model: config.model,
      max_tokens: clampMaxTokens(parsed.max_tokens, config.maxTokensCap),
      messages: split.messages,
      ...(split.system ? { system: split.system } : {}),
      output_config: { effort: config.effort },
      cache_control: { type: "ephemeral" },
    };

    // Start the upstream call and wait for its first event, so connection-time errors
    // (auth, rate limit, overload) still map to a proper HTTP status in both modes.
    const stream = deps.model.stream(params);
    const iterator = stream[Symbol.asyncIterator]();
    let first: IteratorResult<Anthropic.MessageStreamEvent>;
    try {
      first = await iterator.next();
    } catch (err) {
      await refund();
      const mapped = mapUpstreamError(err);
      log({ level: "warn", event: "upstream_error", uid: caller.uid, code: mapped.code, error: String(err) });
      return errorJson(mapped, cors);
    }

    const logDone = (message: Anthropic.Message) =>
      log({
        level: "info",
        event: "chat",
        uid: caller.uid,
        operation: parsed.operation,
        stream: parsed.stream === true,
        stop_reason: message.stop_reason,
        usage: message.usage,
        used: quota.used,
      });

    if (parsed.stream !== true) {
      try {
        for (let r = first; !r.done; r = await iterator.next()) {
          /* drain */
        }
        const message = await stream.finalMessage();
        logDone(message);
        if (message.stop_reason === "refusal") return errorJson(REFUSED, cors);
        return json(
          200,
          {
            content: textOf(message),
            model: message.model,
            usage: message.usage,
            requestId: stream.request_id ?? message.id,
            quota,
          },
          cors,
        );
      } catch (err) {
        await refund();
        const mapped = mapUpstreamError(err);
        log({ level: "warn", event: "upstream_error", uid: caller.uid, code: mapped.code, error: String(err) });
        return errorJson(mapped, cors);
      }
    }

    // --- SSE ---
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (event: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

    const pump = async () => {
      let clientGone = false;
      const safeSend = async (event: unknown) => {
        if (clientGone) return;
        try {
          await send(event);
        } catch {
          clientGone = true;
          stream.abort?.(); // stop paying for tokens nobody will read
        }
      };
      try {
        for (let r = first; !r.done; r = await iterator.next()) {
          const ev = r.value;
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            await safeSend({ type: "delta", text: ev.delta.text });
            if (clientGone) return;
          }
        }
        const message = await stream.finalMessage();
        logDone(message);
        if (message.stop_reason === "refusal") {
          await safeSend({ type: "error", code: REFUSED.code, message: REFUSED.message });
        } else {
          await safeSend({
            type: "done",
            content: textOf(message),
            model: message.model,
            usage: message.usage,
            requestId: stream.request_id ?? message.id,
            quota,
          });
        }
      } catch (err) {
        if (clientGone) return;
        await refund();
        const mapped = mapUpstreamError(err);
        log({ level: "warn", event: "upstream_error", uid: caller.uid, code: mapped.code, error: String(err) });
        await safeSend({ type: "error", code: mapped.code, message: mapped.message });
      } finally {
        release();
        try {
          await writer.close();
        } catch {
          /* already closed/errored */
        }
      }
    };

    releaseInStream = true;
    const done = pump();
    deps.waitUntil?.(done);

    return new Response(readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        ...cors,
      },
    });
  } finally {
    if (!releaseInStream) release();
  }
}
