import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import type { Deps, ModelClient, ModelStream } from "../src/app";
import { AuthError, type TokenVerifier } from "../src/auth";
import { loadConfig, type Env } from "../src/config";
import { D1QuotaStore } from "../src/quota";
import { D1StorageStore } from "../src/storage";

/** Minimal D1 stand-in backed by node:sqlite, with the real migrations applied. */
export function makeD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
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

interface FakeObject {
  bytes: Uint8Array;
  contentType?: string;
  uploaded: Date;
}

/** In-memory stand-in for the subset of R2Bucket the files routes use. */
export function makeR2() {
  const store = new Map<string, FakeObject>();
  const ops: string[] = [];
  const meta = (key: string, v: FakeObject) => ({
    key,
    size: v.bytes.byteLength,
    uploaded: v.uploaded,
    httpMetadata: { contentType: v.contentType },
  });
  const bucket = {
    async head(key: string) {
      ops.push(`head ${key}`);
      const v = store.get(key);
      return v ? meta(key, v) : null;
    },
    async get(key: string) {
      ops.push(`get ${key}`);
      const v = store.get(key);
      if (!v) return null;
      return {
        ...meta(key, v),
        body: new Blob([v.bytes]).stream(),
        arrayBuffer: async () => v.bytes.slice().buffer,
      };
    },
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      ops.push(`put ${key}`);
      const v = { bytes: new Uint8Array(value).slice(), contentType: opts?.httpMetadata?.contentType, uploaded: new Date("2026-11-14T00:00:00Z") };
      store.set(key, v);
      return meta(key, v);
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        ops.push(`delete ${k}`);
        store.delete(k);
      }
    },
    async list(o: { prefix?: string; cursor?: string; limit?: number } = {}) {
      ops.push(`list ${o.prefix ?? ""}`);
      const keys = [...store.keys()].filter((k) => k.startsWith(o.prefix ?? "")).sort();
      const start = o.cursor ? Number(o.cursor) : 0;
      const limit = o.limit ?? 1000;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: slice.map((k) => meta(k, store.get(k)!)),
        delimitedPrefixes: [],
        truncated,
        ...(truncated ? { cursor: String(start + limit) } : {}),
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store, ops };
}

export function storageUsedFor(sqlite: DatabaseSync, uid: string): number {
  const row = sqlite.prepare("SELECT used_bytes FROM storage_usage WHERE uid = ?").get(uid) as
    | { used_bytes: number }
    | undefined;
  return row?.used_bytes ?? 0;
}

export function makeDeps(opts: { env?: Partial<Env>; turn?: FakeTurn; now?: Date; files?: boolean } = {}) {
  const { d1, sqlite } = makeD1();
  const r2 = makeR2();
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
    ...(opts.files === false ? {} : { files: { bucket: r2.bucket, storage: new D1StorageStore(d1) } }),
    now: opts.now ? () => opts.now! : undefined,
    waitUntil: (p) => pending.push(p),
    log: (e) => logs.push(e),
  };
  return { deps, model, sqlite, r2, logs, settle: () => Promise.all(pending) };
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
