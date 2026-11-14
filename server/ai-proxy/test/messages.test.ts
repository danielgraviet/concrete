import { describe, expect, it } from "vitest";
import {
  BadRequest,
  clampMaxTokens,
  clampTemperature,
  MAX_MESSAGES,
  normalizeMessages,
  parseChatRequest,
  sanitizeProvider,
  sanitizeReasoning,
} from "../src/messages";

describe("normalizeMessages", () => {
  it("passes OpenAI-style roles straight through, in order", () => {
    const input = [
      { role: "system" as const, content: "A" },
      { role: "user" as const, content: "hi" },
      { role: "system" as const, content: "B" },
      { role: "assistant" as const, content: "{" },
    ];
    expect(normalizeMessages(input)).toEqual(input);
  });

  it("drops whitespace-only messages and extra fields", () => {
    const r = normalizeMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "  " },
      { role: "user", content: "b", name: "x" } as never,
    ]);
    expect(r).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });

  it("rejects system-only or empty input", () => {
    expect(() => normalizeMessages([{ role: "system", content: "x" }])).toThrow(BadRequest);
    expect(() => normalizeMessages([{ role: "user", content: " " }])).toThrow(BadRequest);
  });
});

describe("parseChatRequest", () => {
  it.each([
    [null, /JSON object/],
    [[], /JSON object/],
    [{}, /non-empty array/],
    [{ messages: [] }, /non-empty array/],
    [{ messages: [{ role: "tool", content: "x" }] }, /role/],
    [{ messages: [{ role: "user", content: 1 }] }, /content/],
    [{ messages: [{ role: "user", content: "x" }], max_tokens: "9" }, /max_tokens/],
    [{ messages: [{ role: "user", content: "x" }], temperature: "0.4" }, /temperature/],
    [{ messages: [{ role: "user", content: "x" }], stream: "yes" }, /stream/],
    [{ messages: [{ role: "user", content: "x" }], model: 5 }, /model/],
    [{ messages: Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: "user", content: "x" })) }, /at most/],
  ])("rejects %j", (body, re) => {
    expect(() => parseChatRequest(body)).toThrow(re);
  });

  it("accepts a full request", () => {
    const body = {
      messages: [{ role: "user", content: "x" }],
      max_tokens: 100,
      temperature: 0.4,
      operation: "quiz",
      stream: true,
      model: "whatever",
      provider: { order: ["Cerebras"] },
      reasoning: { enabled: false },
      metadata: { a: 1 },
    };
    expect(parseChatRequest(body)).toEqual(body);
  });
});

describe("clampMaxTokens", () => {
  it("defaults to the cap", () => expect(clampMaxTokens(undefined, 8000)).toBe(8000));
  it("honors smaller values", () => expect(clampMaxTokens(500, 8000)).toBe(500));
  it("ignores attempts to exceed the cap", () => expect(clampMaxTokens(100000, 8000)).toBe(8000));
  it("floors to at least 1", () => {
    expect(clampMaxTokens(0, 8000)).toBe(1);
    expect(clampMaxTokens(-5, 8000)).toBe(1);
    expect(clampMaxTokens(12.7, 8000)).toBe(12);
  });
});

describe("clampTemperature", () => {
  it("defaults to 0.5 like the desktop app", () => expect(clampTemperature(undefined)).toBe(0.5));
  it("clamps to 0..2", () => {
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(3)).toBe(2);
    expect(clampTemperature(0)).toBe(0);
    expect(clampTemperature(1.3)).toBe(1.3);
  });
});

describe("sanitizeProvider", () => {
  it("keeps only order (≤5 non-empty strings), allow_fallbacks and sort", () => {
    expect(
      sanitizeProvider({
        order: ["Cerebras", 1, "", "x".repeat(65), "B", "C", "D", "E", "F"],
        allow_fallbacks: false,
        sort: "latency",
        ignore: ["y"],
        data_collection: "deny",
      }),
    ).toEqual({ order: ["Cerebras", "B", "C", "D", "E"], allow_fallbacks: false, sort: "latency" });
  });

  it("returns undefined for junk", () => {
    expect(sanitizeProvider(undefined)).toBeUndefined();
    expect(sanitizeProvider("Cerebras")).toBeUndefined();
    expect(sanitizeProvider(["Cerebras"])).toBeUndefined();
    expect(sanitizeProvider({ sort: "cheapest", allow_fallbacks: 1, order: "Cerebras" })).toBeUndefined();
  });
});

describe("sanitizeReasoning", () => {
  it("keeps only enabled, effort (fixed list) and exclude", () => {
    expect(sanitizeReasoning({ enabled: true, effort: "minimal", exclude: false, max_tokens: 5 })).toEqual({
      enabled: true,
      effort: "minimal",
      exclude: false,
    });
  });

  it("drops unknown efforts and junk", () => {
    expect(sanitizeReasoning({ effort: "turbo" })).toBeUndefined();
    expect(sanitizeReasoning(null)).toBeUndefined();
    expect(sanitizeReasoning({ enabled: "no" })).toBeUndefined();
  });
});
