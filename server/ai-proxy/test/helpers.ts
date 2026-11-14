import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import type { Deps, ModelClient, ModelStream } from "../src/app";
import { AuthError, type TokenVerifier } from "../src/auth";
import { loadConfig, type Env } from "../src/config";
import { D1QuotaStore } from "../src/quota";

/** Minimal D1 stand-in backed by node:sqlite, with the real migration applied. */
export function makeD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../migrations/0001_usage.sql"), "utf8"));
  const stmt = (sql: string, args: unknown[]) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (sqlite.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => {
      sqlite.prepare(sql).run(...(args as never[]));
      return { success: true };
    },
  });
  const d1 = { prepare: (sql: string) => stmt(sql, []) } as unknown as D1Database;
  return { d1, sqlite };
}

/** Accepts tokens of the form `good:<uid>`. */
export const fakeVerifier: TokenVerifier = async (token) => {
  if (token.startsWith("good:")) return { uid: token.slice(5) };
  throw new AuthError("bad token");
};

export interface FakeTurn {
  texts?: string[];
  stopReason?: Anthropic.StopReason;
  /** Throw this error when the iterator reaches index `throwAt` (0 = before first event). */
  error?: unknown;
  throwAt?: number;
}

export function fakeModel(turn: FakeTurn = {}) {
  const calls: Anthropic.MessageStreamParams[] = [];
  let aborted = false;
  const client: ModelClient = {
    stream(params) {
      calls.push(params);
      const texts = turn.texts ?? ["Hello", ", world"];
      const events = [
        { type: "message_start" },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
        ...texts.map((text) => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text } })),
        { type: "message_stop" },
      ] as unknown as Anthropic.MessageStreamEvent[];
      const s: ModelStream = {
        request_id: "req_test_123",
        abort: () => {
          aborted = true;
        },
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < events.length; i++) {
            if (turn.error !== undefined && (turn.throwAt ?? 0) === i) throw turn.error;
            yield events[i];
          }
        },
        async finalMessage() {
          if (turn.error !== undefined) throw turn.error;
          return {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [
              { type: "thinking", thinking: "", signature: "x" },
              { type: "text", text: texts.join(""), citations: null },
            ],
            stop_reason: turn.stopReason ?? "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          } as unknown as Anthropic.Message;
        },
      };
      return s;
    },
  };
  return { client, calls, wasAborted: () => aborted };
}

export function rateLimitError() {
  return new Anthropic.RateLimitError(429, { type: "error" }, "rate limited sk-ant-SECRET", new Headers());
}

export function serverError() {
  return Anthropic.APIError.generate(500, { type: "error", error: { message: "raw upstream body" } }, "boom", new Headers());
}

export function makeDeps(opts: { env?: Partial<Env>; turn?: FakeTurn; now?: Date } = {}) {
  const { d1, sqlite } = makeD1();
  const model = fakeModel(opts.turn);
  const logs: Record<string, unknown>[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: Deps = {
    config: loadConfig({
      DB: d1,
      ANTHROPIC_API_KEY: "sk-test",
      FIREBASE_PROJECT_ID: "concrete-test",
      ALLOWED_ORIGINS: "https://app.example.com,http://localhost:5173",
      ...opts.env,
    } as Env),
    verifyToken: fakeVerifier,
    quota: new D1QuotaStore(d1),
    model: model.client,
    now: opts.now ? () => opts.now! : undefined,
    waitUntil: (p) => pending.push(p),
    log: (e) => logs.push(e),
  };
  return { deps, model, sqlite, logs, settle: () => Promise.all(pending) };
}

export function usedFor(sqlite: DatabaseSync, uid: string): number {
  const row = sqlite.prepare("SELECT used FROM usage WHERE uid = ?").get(uid) as { used: number } | undefined;
  return row?.used ?? 0;
}

export function chatRequest(body: unknown, token: string | null = "good:alice", origin?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return new Request("https://proxy.example.com/v1/chat", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function readSse(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}
