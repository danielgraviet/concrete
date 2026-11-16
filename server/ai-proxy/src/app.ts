import { AuthError, bearerToken, type TokenVerifier } from "./auth";
import { BurstLimiter } from "./burst";
import type { Config } from "./config";
import { corsHeaders, preflight } from "./cors";
import { mapUpstreamError, REFUSED, type MappedError } from "./errors";
import { filesRouteMethods, handleFiles, type FilesDeps } from "./files";
import { json, type Cors } from "./http";
import {
  BadRequest,
  clampMaxTokens,
  clampTemperature,
  normalizeMessages,
  parseChatRequest,
  sanitizeProvider,
  sanitizeReasoning,
  type ChatMessage,
  type ChatRequest,
} from "./messages";
import { Completion, openStream, type OpenRouterBody, type OpenRouterChunk, type Upstream } from "./openrouter";
import { periodFor, resetsAtFor, UNLIMITED, type QuotaInfo, type QuotaStore } from "./quota";

export const MAX_BODY_BYTES = 400 * 1024;

export interface Deps {
  config: Config;
  verifyToken: TokenVerifier;
  quota: QuotaStore;
  /** OpenRouter access (API key + fetch; tests inject a fake fetch). */
  upstream: Upstream;
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

/** Chooses the OpenRouter model: the client's pick when allowlisted, else the server default. */
export function chooseModel(requested: string | undefined, config: Config): string {
  return requested !== undefined && config.allowedModels.has(requested) ? requested : config.defaultModel;
}

export function buildUpstreamBody(parsed: ChatRequest, messages: ChatMessage[], model: string, config: Config): OpenRouterBody {
  const provider = sanitizeProvider(parsed.provider);
  const reasoning = sanitizeReasoning(parsed.reasoning);
  return {
    model,
    messages,
    max_tokens: clampMaxTokens(parsed.max_tokens, config.maxTokensCap),
    temperature: clampTemperature(parsed.temperature),
    ...(provider ? { provider } : {}),
    ...(reasoning ? { reasoning } : {}),
    stream: true,
    usage: { include: true },
  };
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

  let parsed: ChatRequest;
  let messages: ChatMessage[];
  try {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new BadRequest("body is not valid JSON");
    }
    parsed = parseChatRequest(body);
    messages = normalizeMessages(parsed.messages);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: "bad_request", detail: err.message }, cors);
    throw err;
  }

  const model = chooseModel(parsed.model, config);
  if (parsed.model !== undefined && parsed.model !== model) {
    log({ level: "info", event: "client_model_substituted", uid: caller.uid, requested: parsed.model, using: model });
  }
  const upstreamBody = buildUpstreamBody(parsed, messages, model, config);

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

    const completion = new Completion(model);
    let costRecorded = false;
    /** Adds whatever OpenRouter reported as spent (also after failures; billed tokens are billed). */
    const recordCost = async () => {
      if (costRecorded) return;
      costRecorded = true;
      if (completion.cost <= 0) return;
      try {
        await deps.quota.addCost(caller.uid, caller.period, completion.cost);
      } catch (err) {
        log({ level: "error", event: "cost_record_failed", uid: caller.uid, error: String(err) });
      }
    };
    const failed = async (err: unknown): Promise<MappedError> => {
      await refund();
      await recordCost();
      const mapped = mapUpstreamError(err);
      log({ level: "warn", event: "upstream_error", uid: caller.uid, model, code: mapped.code, error: String(err) });
      return mapped;
    };
    const logDone = () =>
      log({
        level: "info",
        event: "chat",
        uid: caller.uid,
        operation: parsed.operation,
        stream: parsed.stream === true,
        model: completion.model,
        finish_reason: completion.finishReason,
        usage: completion.usage,
        used: quota.used,
      });
    const doneBody = () => ({
      content: completion.content,
      model: completion.model,
      usage: completion.usage,
      ...(completion.id ? { requestId: completion.id } : {}),
      quota,
    });

    // Open the upstream stream and wait for its first data chunk, so connection-time
    // errors (auth, credits, rate limit, moderation) still map to a proper HTTP status.
    let upstream;
    let first: IteratorResult<OpenRouterChunk>;
    let firstDelta = "";
    try {
      upstream = await openStream(deps.upstream, upstreamBody);
      first = await upstream.chunks.next();
      if (!first.done) firstDelta = completion.apply(first.value);
    } catch (err) {
      upstream?.abort();
      return errorJson(await failed(err), cors);
    }
    const { chunks } = upstream;

    if (parsed.stream !== true) {
      try {
        if (!first.done) {
          for (let r = await chunks.next(); !r.done; r = await chunks.next()) completion.apply(r.value);
        }
      } catch (err) {
        return errorJson(await failed(err), cors);
      }
      await recordCost();
      logDone();
      if (completion.refused) return errorJson(REFUSED, cors);
      return json(200, doneBody(), cors);
    }

    // --- SSE ---
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (event: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    const abortUpstream = upstream.abort;

    const pump = async () => {
      let clientGone = false;
      const safeSend = async (event: unknown) => {
        if (clientGone) return;
        try {
          await send(event);
        } catch {
          clientGone = true;
          abortUpstream(); // stop paying for tokens nobody will read
        }
      };
      try {
        if (firstDelta) await safeSend({ type: "delta", text: firstDelta });
        if (!first.done && !clientGone) {
          for (let r = await chunks.next(); !r.done; r = await chunks.next()) {
            const text = completion.apply(r.value);
            if (text) await safeSend({ type: "delta", text });
            if (clientGone) {
              void chunks.return?.(undefined)?.catch(() => {});
              return;
            }
          }
        }
        await recordCost();
        logDone();
        if (completion.refused) {
          await safeSend({ type: "error", code: REFUSED.code, message: REFUSED.message });
        } else {
          await safeSend({ type: "done", ...doneBody() });
        }
      } catch (err) {
        if (clientGone) return;
        const mapped = await failed(err);
        await safeSend({ type: "error", code: mapped.code, message: mapped.message });
      } finally {
        await recordCost();
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
