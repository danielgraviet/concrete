import { describe, expect, it } from "vitest";
import { BadRequest, clampMaxTokens, parseChatRequest, splitMessages } from "../src/messages";

describe("splitMessages", () => {
  it("concatenates system messages in order into the system param", () => {
    const r = splitMessages([
      { role: "system", content: "A" },
      { role: "user", content: "hi" },
      { role: "system", content: "B" },
    ]);
    expect(r.system).toBe("A\n\nB");
    expect(r.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("omits system when there are none", () => {
    expect(splitMessages([{ role: "user", content: "hi" }]).system).toBeUndefined();
  });

  it("merges consecutive same-role turns", () => {
    const r = splitMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
      { role: "system", content: "s" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
    ]);
    expect(r.messages).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c\n\nd" },
      { role: "user", content: "e" },
    ]);
  });

  it("drops empty messages", () => {
    const r = splitMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "  " },
      { role: "user", content: "b" },
    ]);
    expect(r.messages).toEqual([{ role: "user", content: "a\n\nb" }]);
  });

  it("rejects conversations starting with assistant", () => {
    expect(() =>
      splitMessages([
        { role: "assistant", content: "x" },
        { role: "user", content: "y" },
      ]),
    ).toThrow(/start with a user/);
  });

  it("rejects trailing assistant (prefill)", () => {
    expect(() =>
      splitMessages([
        { role: "user", content: "x" },
        { role: "assistant", content: "{" },
      ]),
    ).toThrow(/end with a user/);
  });

  it("rejects system-only input", () => {
    expect(() => splitMessages([{ role: "system", content: "x" }])).toThrow(BadRequest);
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
    [{ messages: [{ role: "user", content: "x" }], stream: "yes" }, /stream/],
  ])("rejects %j", (body, re) => {
    expect(() => parseChatRequest(body)).toThrow(re);
  });

  it("accepts a full request", () => {
    const body = {
      messages: [{ role: "user", content: "x" }],
      max_tokens: 100,
      operation: "quiz",
      stream: true,
      model: "whatever",
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
