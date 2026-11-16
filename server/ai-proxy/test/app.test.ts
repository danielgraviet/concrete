import { describe, expect, it } from "vitest";
import { handleRequest, MAX_BODY_BYTES } from "../src/app";
import { BurstLimiter } from "../src/burst";
import { OPENROUTER_URL } from "../src/openrouter";
import {
  chatRequest,
  costFor,
  makeDeps,
  openRouterStream,
  readSse,
  sse,
  TEST_USAGE,
  usedFor,
} from "./helpers";

const USER = { messages: [{ role: "user", content: "Make a quiz" }] };
const ORIGIN = "https://app.example.com";
const NOW = new Date("2026-11-14T12:00:00Z");
const QUOTA_1 = { used: 1, limit: 100, resetsAt: "2026-12-01T00:00:00.000Z" };

describe("routing, auth, CORS", () => {
  it("GET /health needs no auth", async () => {
    const { deps } = makeDeps();
    const res = await handleRequest(new Request("https://p/health"), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 without a bearer token", async () => {
    const { deps, model } = makeDeps();
    const res = await handleRequest(chatRequest(USER, null), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(model.calls).toHaveLength(0);
  });

  it("returns 401 for an invalid token on every protected route", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(chatRequest(USER, "bad"), deps)).status).toBe(401);
    const q = new Request("https://p/v1/quota", { headers: { authorization: "Bearer bad" } });
    expect((await handleRequest(q, deps)).status).toBe(401);
  });

  it("answers preflight for allowed origins", async () => {
    const { deps } = makeDeps();
    const res = await handleRequest(
      new Request("https://p/v1/chat", {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "access-control-request-method": "POST" },
      }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("refuses preflight for unknown origins", async () => {
    const { deps } = makeDeps();
    const res = await handleRequest(
      new Request("https://p/v1/chat", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      deps,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds CORS headers to responses (including errors) for allowed origins only", async () => {
    const { deps } = makeDeps();
    const ok = await handleRequest(chatRequest(USER, null, ORIGIN), deps);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await handleRequest(chatRequest(USER, null, "https://evil.example"), deps);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("404s unknown paths and 405s wrong methods", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(new Request("https://p/nope"), deps)).status).toBe(404);
    expect((await handleRequest(new Request("https://p/v1/chat"), deps)).status).toBe(405);
  });
});

describe("POST /v1/chat → OpenRouter request", () => {
  it("calls OpenRouter with auth, attribution headers, streaming and usage accounting", async () => {
    const { deps, model } = makeDeps({ now: NOW });
    const res = await handleRequest(
      chatRequest({
        messages: [
          { role: "system", content: "You are a tutor." },
          { role: "user", content: "Quiz me" },
          { role: "assistant", content: "{" },
        ],
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const call = model.calls[0];
    expect(call.url).toBe(OPENROUTER_URL);
    expect(call.headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
      "HTTP-Referer": "https://app.example.com",
      "X-Title": "Concrete",
    });
    expect(call.body).toEqual({
      model: "deepseek/deepseek-v4-flash-0731",
      // OpenAI-style roles pass straight through: system stays in messages, trailing assistant is allowed.
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: "Quiz me" },
        { role: "assistant", content: "{" },
      ],
      max_tokens: 8000,
      temperature: 0.5,
      stream: true,
      usage: { include: true },
    });
  });

  it("omits HTTP-Referer when APP_URL is unset", async () => {
    const { deps, model } = makeDeps({ env: { APP_URL: "" } });
    await handleRequest(chatRequest(USER), deps);
    expect(model.calls[0].headers).not.toHaveProperty("HTTP-Referer");
  });

  it("drops whitespace-only messages but keeps order", async () => {
    const { deps, model } = makeDeps();
    await handleRequest(
      chatRequest({
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "  " },
          { role: "user", content: "b" },
        ],
      }),
      deps,
    );
    expect(model.calls[0].body.messages).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });

  it("uses an allowlisted client model", async () => {
    const { deps, model, logs } = makeDeps();
    await handleRequest(chatRequest({ ...USER, model: "openai/gpt-5.6-luna" }), deps);
    expect(model.calls[0].body.model).toBe("openai/gpt-5.6-luna");
    expect(logs.some((l) => l.event === "client_model_substituted")).toBe(false);
  });

  it("substitutes the default for a model outside the allowlist, and logs it", async () => {
    const { deps, model, logs } = makeDeps({ env: { DEFAULT_MODEL: "qwen/qwen3.7-flash" } });
    await handleRequest(chatRequest({ ...USER, model: "anthropic/claude-opus-5.5" }), deps);
    expect(model.calls[0].body.model).toBe("qwen/qwen3.7-flash");
    expect(
      logs.some(
        (l) =>
          l.event === "client_model_substituted" &&
          l.requested === "anthropic/claude-opus-5.5" &&
          l.using === "qwen/qwen3.7-flash",
      ),
    ).toBe(true);
  });

  it("honors a custom ALLOWED_MODELS list (plus the default)", async () => {
    const { deps, model } = makeDeps({ env: { ALLOWED_MODELS: "x/one, y/two" } });
    await handleRequest(chatRequest({ ...USER, model: "y/two" }), deps);
    await handleRequest(chatRequest({ ...USER, model: "openai/gpt-4o-mini" }), deps);
    await handleRequest(chatRequest({ ...USER, model: "deepseek/deepseek-v4-flash-0731" }), deps);
    expect(model.calls.map((c) => c.body.model)).toEqual([
      "y/two",
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash-0731",
    ]);
  });

  it("clamps max_tokens and temperature", async () => {
    const { deps, model } = makeDeps({ env: { MAX_TOKENS_CAP: "2000" } });
    await handleRequest(chatRequest({ ...USER, max_tokens: 999999, temperature: 7 }), deps);
    await handleRequest(chatRequest({ ...USER, max_tokens: 300, temperature: -1 }), deps);
    await handleRequest(chatRequest({ ...USER, temperature: 0.55 }), deps);
    expect(model.calls.map((c) => [c.body.max_tokens, c.body.temperature])).toEqual([
      [2000, 2],
      [300, 0],
      [2000, 0.55],
    ]);
  });

  it("passes through sanitized provider and reasoning prefs", async () => {
    const { deps, model } = makeDeps();
    await handleRequest(
      chatRequest({
        ...USER,
        provider: {
          order: ["Cerebras", 7, "", "A", "B", "C", "D", "E"],
          allow_fallbacks: true,
          sort: "throughput",
          data_collection: "allow",
          only: ["x"],
        },
        reasoning: { enabled: false, effort: "low", exclude: true, max_tokens: 99999 },
      }),
      deps,
    );
    expect(model.calls[0].body.provider).toEqual({
      order: ["Cerebras", "A", "B", "C", "D"],
      allow_fallbacks: true,
      sort: "throughput",
    });
    expect(model.calls[0].body.reasoning).toEqual({ enabled: false, effort: "low", exclude: true });
  });

  it("omits provider/reasoning when nothing valid survives", async () => {
    const { deps, model } = makeDeps();
    await handleRequest(
      chatRequest({ ...USER, provider: { sort: "random", allow_fallbacks: "yes" }, reasoning: { effort: "ultra" } }),
      deps,
    );
    expect(model.calls[0].body).not.toHaveProperty("provider");
    expect(model.calls[0].body).not.toHaveProperty("reasoning");
  });
});

describe("POST /v1/chat (non-stream)", () => {
  it("returns content, model, usage (with cost), requestId, quota", async () => {
    const { deps, sqlite } = makeDeps({ now: NOW });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      content: "Hello, world",
      model: "deepseek/deepseek-v4-flash-0731",
      usage: TEST_USAGE,
      requestId: "gen-test-123",
      quota: QUOTA_1,
    });
    expect(usedFor(sqlite, "alice")).toBe(1);
  });

  it("accumulates per-user monthly cost_usd in D1", async () => {
    const { deps, sqlite } = makeDeps({
      upstream: [
        { chunks: openRouterStream({ usage: { ...TEST_USAGE, cost: 0.25 } }) },
        { chunks: openRouterStream({ usage: { ...TEST_USAGE, cost: 0.5 } }) },
        { chunks: openRouterStream({ usage: { prompt_tokens: 1 } }) },
      ],
    });
    for (let i = 0; i < 3; i++) await handleRequest(chatRequest(USER), deps);
    expect(costFor(sqlite, "alice")).toBeCloseTo(0.75, 10);
    expect(usedFor(sqlite, "alice")).toBe(3);
  });

  it("400s invalid bodies without spending quota or calling OpenRouter", async () => {
    for (const body of [
      { messages: [{ role: "system", content: "only system" }] },
      { messages: [{ role: "tool", content: "x" }] },
      { ...USER, temperature: "hot" },
    ]) {
      const { deps, sqlite, model } = makeDeps();
      const res = await handleRequest(chatRequest(body), deps);
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe("bad_request");
      expect(typeof json.detail).toBe("string");
      expect(usedFor(sqlite, "alice")).toBe(0);
      expect(model.calls).toHaveLength(0);
    }
  });

  it("400s malformed JSON", async () => {
    const { deps } = makeDeps();
    const res = await handleRequest(chatRequest("{not json"), deps);
    expect(res.status).toBe(400);
  });

  it("413s bodies over 400 KB", async () => {
    const { deps, model } = makeDeps();
    const big = { messages: [{ role: "user", content: "x".repeat(MAX_BODY_BYTES) }] };
    const res = await handleRequest(chatRequest(big), deps);
    expect(res.status).toBe(413);
    expect(model.calls).toHaveLength(0);
  });

  it("429s when the monthly quota is exhausted, before calling OpenRouter", async () => {
    const { deps, model } = makeDeps({ env: { QUOTA_MONTHLY: "2" }, now: NOW });
    expect((await handleRequest(chatRequest(USER), deps)).status).toBe(200);
    expect((await handleRequest(chatRequest(USER), deps)).status).toBe(200);
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "quota_exceeded",
      used: 2,
      limit: 2,
      resetsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(model.calls).toHaveLength(2);
  });

  it("exempts allowlisted uids", async () => {
    const { deps } = makeDeps({ env: { QUOTA_MONTHLY: "1", QUOTA_ALLOWLIST_UIDS: "owner, someone" } });
    for (let i = 0; i < 3; i++) {
      const res = await handleRequest(chatRequest(USER, "good:owner"), deps);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { quota: { used: number; limit: number } };
      expect(body.quota).toMatchObject({ used: i + 1, limit: -1 });
    }
  });

  it.each([
    [401, undefined, 502, "upstream_error"],
    [403, { error: { code: 403, message: "Key disabled" } }, 502, "upstream_error"],
    [402, { error: { code: 402, message: "Insufficient credits sk-or-SECRET" } }, 503, "upstream_out_of_credits"],
    [429, undefined, 503, "upstream_rate_limited"],
    [
      403,
      { error: { code: 403, message: "Input was flagged", metadata: { reasons: ["violence"], flagged_input: "..." } } },
      422,
      "refused",
    ],
    [400, undefined, 502, "upstream_error"],
    [408, undefined, 502, "upstream_error"],
    [500, undefined, 502, "upstream_error"],
    [503, undefined, 502, "upstream_error"],
  ])("maps OpenRouter HTTP %i to %i %s, refunds, and leaks nothing", async (status, errorBody, expected, code) => {
    const { deps, sqlite } = makeDeps({ upstream: { status, errorBody } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(expected);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe(code);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("raw upstream body");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("uses the fixed message for out-of-credits", async () => {
    const { deps } = makeDeps({ upstream: { status: 402 } });
    const body = (await (await handleRequest(chatRequest(USER), deps)).json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "upstream_out_of_credits", message: "AI is temporarily unavailable" });
  });

  it("maps a network failure to 502 and refunds", async () => {
    const { deps, sqlite } = makeDeps({ upstream: { fetchError: new TypeError("fetch failed") } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("maps an upstream timeout to 502 and refunds", async () => {
    const { deps, sqlite, model } = makeDeps({ upstream: { chunks: [": OPENROUTER PROCESSING\n\n"], hang: true }, idleTimeoutMs: 20 });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
    expect(usedFor(sqlite, "alice")).toBe(0);
    expect(model.wasAborted()).toBe(true);
  });

  it("maps an error chunk before any content to a proper HTTP status", async () => {
    const { deps, sqlite } = makeDeps({
      upstream: { chunks: [sse({ error: { code: 429, message: "Provider rate limited sk-or-SECRET" } })] },
    });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("upstream_rate_limited");
    expect(text).not.toContain("SECRET");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("maps a mid-stream error chunk to 502 and refunds", async () => {
    const [comment, role, hello] = openRouterStream();
    const { deps, sqlite } = makeDeps({
      upstream: {
        chunks: [
          comment,
          role,
          hello,
          sse({ id: "gen-x", error: { code: "server_error", message: "Provider disconnected" }, choices: [{ delta: { content: "" }, finish_reason: "error" }] }),
        ],
      },
    });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(502);
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("maps a content_filter finish to 422 refused (no refund: tokens were billed)", async () => {
    const { deps, sqlite } = makeDeps({ upstream: { chunks: openRouterStream({ texts: [], finishReason: "content_filter" }) } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("refused");
    expect(usedFor(sqlite, "alice")).toBe(1);
  });

  it("returns an empty completion as content \"\" (client-side fallbacks handle it)", async () => {
    const { deps } = makeDeps({ upstream: { chunks: openRouterStream({ texts: [] }) } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { content: string }).content).toBe("");
  });

  it("429s rate_limited when the burst limiter trips", async () => {
    const { deps, sqlite } = makeDeps();
    deps.burst = new BurstLimiter(5, 1, 60_000);
    expect((await handleRequest(chatRequest(USER), deps)).status).toBe(200);
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(usedFor(sqlite, "alice")).toBe(1);
  });
});

describe("POST /v1/chat (stream)", () => {
  it("streams text deltas only, then a done event", async () => {
    const { deps, settle, sqlite } = makeDeps({ now: NOW });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }, "good:alice", ORIGIN), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const events = await readSse(res);
    await settle();
    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "delta", text: ", world" },
      {
        type: "done",
        content: "Hello, world",
        model: "deepseek/deepseek-v4-flash-0731",
        usage: TEST_USAGE,
        requestId: "gen-test-123",
        quota: QUOTA_1,
      },
    ]);
    expect(costFor(sqlite, "alice")).toBeCloseTo(TEST_USAGE.cost, 10);
  });

  it("parses OpenRouter SSE split at arbitrary chunk boundaries (CRLF, comments, [DONE])", async () => {
    const whole = openRouterStream({ texts: ["Héllo", " wörld", " ✓"] }).join("").replace(/\n/g, "\r\n");
    // Split into 7-byte pieces, cutting through UTF-8 sequences, CRLFs, "data:" and JSON.
    const bytes = new TextEncoder().encode(whole);
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));
    const { deps, settle } = makeDeps({ upstream: { chunks: pieces } });
    const events = await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
    expect(deltas.join("")).toBe("Héllo wörld ✓");
    expect(events.at(-1)).toMatchObject({ type: "done", content: "Héllo wörld ✓", usage: TEST_USAGE });
  });

  it("handles a final event without a trailing blank line", async () => {
    const chunks = openRouterStream().slice(0, -1); // no [DONE]
    chunks[chunks.length - 1] = chunks[chunks.length - 1].trimEnd();
    const { deps, settle } = makeDeps({ upstream: { chunks } });
    const events = await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    expect(events.at(-1)).toMatchObject({ type: "done", usage: TEST_USAGE });
  });

  it("returns a plain HTTP error if OpenRouter fails before the first chunk", async () => {
    const { deps, sqlite } = makeDeps({ upstream: { status: 429 } });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("emits an error event and refunds on a mid-stream error chunk", async () => {
    const [comment, role, hello] = openRouterStream();
    const { deps, sqlite, settle } = makeDeps({
      upstream: {
        chunks: [comment, role, hello, sse({ error: { code: 502, message: "raw upstream body" }, choices: [{ delta: {}, finish_reason: "error" }] })],
      },
    });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    expect(res.status).toBe(200);
    const events = await readSse(res);
    await settle();
    expect(events[0]).toEqual({ type: "delta", text: "Hello" });
    expect(events.at(-1)).toEqual({ type: "error", code: "upstream_error", message: expect.any(String) });
    expect(JSON.stringify(events)).not.toContain("raw upstream body");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("emits an error event and refunds when the connection drops mid-stream", async () => {
    const [comment, role, hello] = openRouterStream();
    const { deps, sqlite, settle } = makeDeps({ upstream: { chunks: [comment, role, hello], errorAfterChunks: true } });
    const events = await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "upstream_error" });
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("emits a moderation error event as refused", async () => {
    const [comment, role, hello] = openRouterStream();
    const { deps, settle } = makeDeps({
      upstream: { chunks: [comment, role, hello, sse({ error: { code: 403, message: "Output flagged by moderation" } })] },
    });
    const events = await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" });
  });

  it("emits a refused error event on content_filter", async () => {
    const { deps, settle } = makeDeps({ upstream: { chunks: openRouterStream({ finishReason: "content_filter" }) } });
    const events = await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" });
  });

  it("aborts the upstream request when the client goes away", async () => {
    const [comment, role, hello] = openRouterStream();
    const { deps, settle, model } = makeDeps({ upstream: { chunks: [comment, role, hello, hello, hello], hang: true } });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    await res.body!.cancel();
    await settle();
    expect(model.wasAborted()).toBe(true);
  });

  it("releases the burst slot when the stream ends", async () => {
    const { deps, settle } = makeDeps();
    deps.burst = new BurstLimiter(1, 100, 60_000);
    await readSse(await handleRequest(chatRequest({ ...USER, stream: true }), deps));
    await settle();
    expect((await handleRequest(chatRequest(USER), deps)).status).toBe(200);
  });
});

describe("GET /v1/quota", () => {
  it("reports usage for the current period", async () => {
    const { deps } = makeDeps({ now: NOW, env: { QUOTA_MONTHLY: "50" } });
    await handleRequest(chatRequest(USER), deps);
    const res = await handleRequest(
      new Request("https://p/v1/quota", { headers: { authorization: "Bearer good:alice" } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 1, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" });
  });
});
