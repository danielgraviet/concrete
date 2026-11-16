import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { Deps } from "../src/app";
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

export const TEST_USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.00042 };

/** One OpenRouter SSE `data:` event. */
export function sse(payload: unknown): string {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
}

/** A realistic OpenRouter stream: processing comment, role chunk, text deltas, finish, usage, [DONE]. */
export function openRouterStream(
  opts: { texts?: string[]; model?: string; finishReason?: string; usage?: unknown; id?: string } = {},
): string[] {
  const id = opts.id ?? "gen-test-123";
  const model = opts.model ?? "deepseek/deepseek-v4-flash-0731";
  const texts = opts.texts ?? ["Hello", ", world"];
  return [
    ": OPENROUTER PROCESSING\n\n",
    sse({ id, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    ...texts.map((content) => sse({ id, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
    sse({ id, model, choices: [{ index: 0, delta: {}, finish_reason: opts.finishReason ?? "stop" }] }),
    sse({ id, model, choices: [], usage: opts.usage ?? TEST_USAGE }),
    "data: [DONE]\n\n",
  ];
}

export interface FakeUpstreamSpec {
  /** HTTP status for the response (default 200). */
  status?: number;
  /** JSON body for a non-2xx response. */
  errorBody?: unknown;
  /** Raw SSE text pieces, enqueued as separate network chunks (default: `openRouterStream()`). */
  chunks?: (string | Uint8Array)[];
  /** Reject the fetch itself (network failure). */
  fetchError?: unknown;
  /** Error the body stream after all chunks are delivered. */
  errorAfterChunks?: boolean;
  /** Keep the body open after the chunks (until aborted). */
  hang?: boolean;
}

export interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Fake `fetch` for OpenRouter. Pass one spec, or an array consumed one per call. */
export function fakeOpenRouter(spec: FakeUpstreamSpec | FakeUpstreamSpec[] = {}) {
  const calls: UpstreamCall[] = [];
  let aborted = false;
  const specs = Array.isArray(spec) ? spec : null;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const s = specs ? (specs[calls.length] ?? specs[specs.length - 1]) : (spec as FakeUpstreamSpec);
    calls.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const signal = init?.signal;
    signal?.addEventListener("abort", () => {
      aborted = true;
    });
    if (s.fetchError !== undefined) throw s.fetchError;
    const status = s.status ?? 200;
    if (status < 200 || status >= 300) {
      return new Response(JSON.stringify(s.errorBody ?? { error: { code: status, message: "raw upstream body sk-or-SECRET" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    const encoder = new TextEncoder();
    const chunks = s.chunks ?? openRouterStream();
    // Delivers one network chunk per read, so a later error doesn't discard queued chunks.
    let i = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("The operation was aborted.", "AbortError"));
            } catch {
              /* already closed */
            }
          });
        },
        pull(controller) {
          if (i < chunks.length) {
            const c = chunks[i++];
            controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
            return;
          }
          if (s.errorAfterChunks) controller.error(new TypeError("network connection lost"));
          else if (!s.hang) controller.close();
          else return new Promise<void>(() => {}); // stay open until aborted
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, wasAborted: () => aborted };
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

export function makeDeps(
  opts: {
    env?: Partial<Env>;
    upstream?: FakeUpstreamSpec | FakeUpstreamSpec[];
    idleTimeoutMs?: number;
    now?: Date;
    files?: boolean;
  } = {},
) {
  const { d1, sqlite } = makeD1();
  const r2 = makeR2();
  const model = fakeOpenRouter(opts.upstream);
  const logs: Record<string, unknown>[] = [];
  const pending: Promise<unknown>[] = [];
  const config = loadConfig({
    DB: d1,
    OPENROUTER_API_KEY: "sk-or-test",
    FIREBASE_PROJECT_ID: "concrete-test",
    ALLOWED_ORIGINS: "https://app.example.com,http://localhost:5173",
    APP_URL: "https://app.example.com",
    ...opts.env,
  } as Env);
  const deps: Deps = {
    config,
    verifyToken: fakeVerifier,
    quota: new D1QuotaStore(d1),
    upstream: {
      apiKey: "sk-or-test",
      appUrl: config.appUrl,
      fetch: model.fetch,
      ...(opts.idleTimeoutMs ? { idleTimeoutMs: opts.idleTimeoutMs } : {}),
    },
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

export function costFor(sqlite: DatabaseSync, uid: string): number {
  const row = sqlite.prepare("SELECT cost_usd FROM usage WHERE uid = ?").get(uid) as { cost_usd: number } | undefined;
  return row?.cost_usd ?? 0;
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
