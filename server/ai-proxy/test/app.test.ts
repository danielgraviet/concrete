import { describe, expect, it } from "vitest";
import { handleRequest, MAX_BODY_BYTES } from "../src/app";
import { BurstLimiter } from "../src/burst";
import { chatRequest, makeDeps, rateLimitError, readSse, serverError, usedFor } from "./helpers";

const USER = { messages: [{ role: "user", content: "Make a quiz" }] };
const ORIGIN = "https://app.example.com";

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

describe("POST /v1/chat (non-stream)", () => {
  it("forwards to the model and returns content, usage, quota", async () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const { deps, model, sqlite } = makeDeps({ now });
    const res = await handleRequest(
      chatRequest({
        messages: [
          { role: "system", content: "You are a tutor." },
          { role: "user", content: "Quiz me" },
        ],
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      content: "Hello, world",
      model: "claude-haiku-5-5",
      usage: { input_tokens: 10, output_tokens: 5 },
      requestId: "req_test_123",
      quota: { used: 1, limit: 100, resetsAt: "2026-12-01T00:00:00.000Z" },
    });
    expect(usedFor(sqlite, "alice")).toBe(1);

    const params = model.calls[0] as unknown as Record<string, unknown>;
    expect(params.system).toBe("You are a tutor.");
    expect(params.messages).toEqual([{ role: "user", content: "Quiz me" }]);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.cache_control).toEqual({ type: "ephemeral" });
    expect(params.max_tokens).toBe(8000);
    for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(params).not.toHaveProperty(k);
  });

  it("ignores client model (and logs it) and clamps max_tokens", async () => {
    const { deps, model, logs } = makeDeps({ env: { MAX_TOKENS_CAP: "2000", EFFORT: "medium", MODEL: "claude-sonnet-5-5" } });
    await handleRequest(chatRequest({ ...USER, model: "claude-opus-5-5", max_tokens: 999999 }), deps);
    const params = model.calls[0] as unknown as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(2000);
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(logs.some((l) => l.event === "client_model_ignored" && l.requested === "claude-opus-5-5")).toBe(true);
  });

  it("400s invalid conversations without spending quota", async () => {
    const { deps, sqlite, model } = makeDeps();
    const res = await handleRequest(chatRequest({ messages: [{ role: "assistant", content: "x" }] }), deps);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("bad_request");
    expect(typeof body.detail).toBe("string");
    expect(usedFor(sqlite, "alice")).toBe(0);
    expect(model.calls).toHaveLength(0);
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

  it("429s when the monthly quota is exhausted, before calling the model", async () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const { deps, model } = makeDeps({ env: { QUOTA_MONTHLY: "2" }, now });
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

  it("maps RateLimitError to 503 and refunds the reserved unit", async () => {
    const { deps, sqlite } = makeDeps({ turn: { error: rateLimitError(), throwAt: 0 } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("upstream_rate_limited");
    expect(text).not.toContain("sk-ant");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("maps other APIErrors to 502 without leaking the upstream body, and refunds", async () => {
    const { deps, sqlite } = makeDeps({ turn: { error: serverError(), throwAt: 2 } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("upstream_error");
    expect(text).not.toContain("raw upstream body");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("maps a refusal to 422 refused", async () => {
    const { deps } = makeDeps({ turn: { stopReason: "refusal" } });
    const res = await handleRequest(chatRequest(USER), deps);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("refused");
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
    const { deps, settle } = makeDeps({ now: new Date("2026-11-14T12:00:00Z") });
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
        model: "claude-haiku-5-5",
        usage: { input_tokens: 10, output_tokens: 5 },
        requestId: "req_test_123",
        quota: { used: 1, limit: 100, resetsAt: "2026-12-01T00:00:00.000Z" },
      },
    ]);
  });

  it("returns a plain HTTP error if the upstream fails before the first event", async () => {
    const { deps, sqlite } = makeDeps({ turn: { error: rateLimitError(), throwAt: 0 } });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    expect(res.status).toBe(503);
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("emits an error event and refunds when the upstream fails mid-stream", async () => {
    const { deps, sqlite, settle } = makeDeps({ turn: { error: serverError(), throwAt: 3 } });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    expect(res.status).toBe(200);
    const events = await readSse(res);
    await settle();
    expect(events[0]).toEqual({ type: "delta", text: "Hello" });
    expect(events.at(-1)).toEqual({
      type: "error",
      code: "upstream_error",
      message: expect.any(String),
    });
    expect(JSON.stringify(events)).not.toContain("raw upstream body");
    expect(usedFor(sqlite, "alice")).toBe(0);
  });

  it("emits a refused error event on refusal", async () => {
    const { deps, settle } = makeDeps({ turn: { stopReason: "refusal" } });
    const res = await handleRequest(chatRequest({ ...USER, stream: true }), deps);
    const events = await readSse(res);
    await settle();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" });
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
    const now = new Date("2026-11-14T12:00:00Z");
    const { deps } = makeDeps({ now, env: { QUOTA_MONTHLY: "50" } });
    await handleRequest(chatRequest(USER), deps);
    const res = await handleRequest(
      new Request("https://p/v1/quota", { headers: { authorization: "Bearer good:alice" } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 1, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" });
  });
});
