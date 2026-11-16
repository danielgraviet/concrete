import { describe, expect, it } from "vitest";
import { mapUpstreamError } from "../src/errors";
import { Completion, failureFromHttp, failureFromStreamError, OpenRouterSseParser, UpstreamFailure } from "../src/openrouter";

describe("OpenRouterSseParser", () => {
  it("ignores comment lines and reports [DONE]", () => {
    const p = new OpenRouterSseParser();
    expect(p.push(": OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n")).toEqual([]);
    expect(p.push('data: {"id":"a"}\n\ndata: [DONE]\n\n')).toEqual([{ id: "a" }]);
    expect(p.done).toBe(true);
  });

  it("reassembles events split anywhere, including inside CRLF", () => {
    const text = 'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\ndata: {"id":"b"}\r\n\r\n';
    for (let cut = 1; cut < text.length; cut++) {
      const p = new OpenRouterSseParser();
      const out = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut)), ...p.end()];
      expect(out).toEqual([{ choices: [{ delta: { content: "hi" } }] }, { id: "b" }]);
    }
  });

  it("joins multi-line data fields and skips malformed JSON", () => {
    const p = new OpenRouterSseParser();
    expect(p.push('data: {"a":\ndata: 1}\n\ndata: {nope\n\nevent: x\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("flushes a trailing event on end()", () => {
    const p = new OpenRouterSseParser();
    expect(p.push('data: {"z":1}')).toEqual([]);
    expect(p.end()).toEqual([{ z: 1 }]);
  });
});

describe("Completion", () => {
  it("accumulates content, model, id, usage, finish reason and cost", () => {
    const c = new Completion("req/model");
    expect(c.apply({ id: "gen-1", model: "real/model", choices: [{ delta: { content: "A" } }] })).toBe("A");
    expect(c.apply({ choices: [{ delta: { content: "B" }, finish_reason: "stop" }] })).toBe("B");
    expect(c.apply({ choices: [], usage: { prompt_tokens: 1, cost: "0.01" } })).toBe("");
    expect(c).toMatchObject({ content: "AB", model: "real/model", id: "gen-1", finishReason: "stop" });
    expect(c.cost).toBe(0.01);
    expect(c.refused).toBe(false);
  });

  it("throws on error chunks", () => {
    expect(() => new Completion("m").apply({ error: { code: 429, message: "x" } })).toThrow(UpstreamFailure);
    expect(() => new Completion("m").apply({ choices: [{ delta: {}, finish_reason: "error" }] })).toThrow(UpstreamFailure);
  });

  it("treats content_filter as refused", () => {
    const c = new Completion("m");
    c.apply({ choices: [{ delta: {}, finish_reason: "content_filter" }] });
    expect(c.refused).toBe(true);
  });
});

describe("error mapping", () => {
  it("maps statuses and moderation", () => {
    expect(mapUpstreamError(failureFromHttp(401, null)).code).toBe("upstream_error");
    expect(mapUpstreamError(failureFromHttp(403, { error: { message: "Key is disabled" } })).code).toBe("upstream_error");
    expect(mapUpstreamError(failureFromHttp(403, { error: { metadata: { reasons: ["hate"] } } })).code).toBe("refused");
    expect(mapUpstreamError(failureFromHttp(402, null))).toEqual({
      status: 503,
      code: "upstream_out_of_credits",
      message: "AI is temporarily unavailable",
    });
    expect(mapUpstreamError(failureFromHttp(429, null)).status).toBe(503);
    expect(mapUpstreamError(failureFromHttp(504, null)).status).toBe(502);
    expect(mapUpstreamError(failureFromStreamError({ code: 402 })).code).toBe("upstream_out_of_credits");
    expect(mapUpstreamError(failureFromStreamError({ code: "server_error" })).code).toBe("upstream_error");
    expect(mapUpstreamError(new UpstreamFailure("timeout", undefined)).status).toBe(502);
    expect(mapUpstreamError(new Error("bug")).code).toBe("internal_error");
  });
});
