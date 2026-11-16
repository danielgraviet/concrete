import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/app";
import { MAX_PATH_LENGTH, sanitizePath } from "../src/files";
import { makeDeps, storageUsedFor, usedFor } from "./helpers";

const ORIGIN = "https://app.example.com";
const MB = 1024 * 1024;

function req(
  method: string,
  path: string,
  opts: { body?: BodyInit; type?: string; token?: string | null; query?: string } = {},
): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  const token = opts.token === undefined ? "good:alice" : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.type) headers["content-type"] = opts.type;
  return new Request(`https://p${path}${opts.query ?? ""}`, { method, headers, body: opts.body });
}

const filePath = (p: string) => `/v1/files/${encodeURIComponent(p)}`;
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

function put(p: string, n: number, type = "image/png", extra: { token?: string; query?: string } = {}) {
  return req("PUT", filePath(p), { body: bytes(n), type, ...extra });
}

async function storage(deps: ReturnType<typeof makeDeps>["deps"], token = "good:alice") {
  return (await handleRequest(req("GET", "/v1/storage", { token }), deps)).json() as Promise<{
    usedBytes: number;
    limitBytes: number;
  }>;
}

describe("files: auth and routing", () => {
  it("requires a valid token on every files route", async () => {
    const { deps } = makeDeps();
    for (const r of [
      req("GET", "/v1/files", { token: null }),
      req("GET", "/v1/storage", { token: "bad" }),
      req("PUT", filePath("a.png"), { body: bytes(3), type: "image/png", token: null }),
      req("GET", filePath("a.png"), { token: "bad" }),
      req("DELETE", filePath("a.png"), { token: null }),
      req("POST", "/v1/files/move", { body: "{}", type: "application/json", token: null }),
    ]) {
      expect((await handleRequest(r, deps)).status).toBe(401);
    }
  });

  it("405s wrong methods and 503s without the FILES binding", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(req("POST", "/v1/files"), deps)).status).toBe(405);
    expect((await handleRequest(req("POST", filePath("a.png")), deps)).status).toBe(405);
    const off = makeDeps({ files: false });
    const res = await handleRequest(req("GET", "/v1/storage"), off.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "files_unavailable" });
  });

  it("preflight allows PUT and DELETE", async () => {
    const { deps } = makeDeps();
    const res = await handleRequest(
      new Request("https://p/v1/files/a.png", { method: "OPTIONS", headers: { origin: ORIGIN } }),
      deps,
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("keys objects by the token's uid and isolates users", async () => {
    const { deps, r2 } = makeDeps();
    expect((await handleRequest(put("Notes/.attachments/x.png", 4), deps)).status).toBe(200);
    expect([...r2.store.keys()]).toEqual(["users/alice/Notes/.attachments/x.png"]);
    const other = await handleRequest(req("GET", filePath("Notes/.attachments/x.png"), { token: "good:bob" }), deps);
    expect(other.status).toBe(404);
    const list = await (await handleRequest(req("GET", "/v1/files", { token: "good:bob" }), deps)).json();
    expect(list).toEqual({ files: [], truncated: false });
  });

  it("never consumes AI quota", async () => {
    const { deps, sqlite } = makeDeps();
    await handleRequest(put("a.png", 10), deps);
    await handleRequest(req("GET", "/v1/files"), deps);
    await handleRequest(req("GET", "/v1/storage"), deps);
    expect(usedFor(sqlite, "alice")).toBe(0);
  });
});

describe("files: path sanitization", () => {
  it("accepts ordinary nested paths", () => {
    expect(sanitizePath("A/B c/.attachments/img-2.png")).toBe("A/B c/.attachments/img-2.png");
  });

  it.each([
    ["", "empty"],
    ["/abs.png", "relative"],
    ["a/../b.png", "'..'"],
    ["../b.png", "'..'"],
    ["a/./b.png", "'.'"],
    ["a//b.png", "empty segment"],
    ["a/", "empty segment"],
    ["a\\b.png", "'/'"],
    ["a\u0000.png", "control"],
    ["x".repeat(MAX_PATH_LENGTH + 1), "too long"],
  ])("rejects %j", (path, why) => {
    expect(() => sanitizePath(path)).toThrow(why);
  });

  it("returns 400 bad_path over HTTP and stores nothing", async () => {
    const { deps, r2 } = makeDeps();
    for (const p of ["../x.png", "a/../../x.png", "/x.png", "a//x.png"]) {
      const res = await handleRequest(put(p, 3), deps);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_path");
    }
    const bad = await handleRequest(req("GET", "/v1/files/%E0%A4%A"), deps);
    expect(bad.status).toBe(400);
    const move = await handleRequest(
      req("POST", "/v1/files/move", { body: JSON.stringify({ from: "a.pdf", to: "../b.pdf" }), type: "application/json" }),
      deps,
    );
    expect(move.status).toBe(400);
    const list = await handleRequest(req("GET", "/v1/files", { query: "?prefix=../" }), deps);
    expect(list.status).toBe(400);
    expect(r2.store.size).toBe(0);
  });
});

describe("files: type and size limits", () => {
  it("accepts every allowed type with a matching extension", async () => {
    const { deps } = makeDeps();
    for (const [p, type] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.JPEG", "image/jpeg"],
      ["a.gif", "image/gif"],
      ["a.webp", "image/webp"],
      ["a.svg", "image/svg+xml"],
      ["Doc.pdf", "application/pdf"],
    ]) {
      expect((await handleRequest(put(p, 3, `${type}; charset=binary`), deps)).status).toBe(200);
    }
  });

  it("rejects disallowed or mismatched types with 415 unsupported_type", async () => {
    const { deps, r2 } = makeDeps();
    for (const [p, type] of [
      ["a.html", "text/html"],
      ["a.png", "text/html"],
      ["a.png", "image/jpeg"],
      ["a", "image/png"],
      ["a.pdf", ""],
    ]) {
      const res = await handleRequest(put(p, 3, type), deps);
      expect(res.status).toBe(415);
      expect(((await res.json()) as { error: string }).error).toBe("unsupported_type");
    }
    expect(r2.store.size).toBe(0);
  });

  it("rejects files over MAX_FILE_MB with 413 too_large", async () => {
    const { deps, r2 } = makeDeps({ env: { MAX_FILE_MB: "1" } });
    expect((await handleRequest(put("ok.png", MB), deps)).status).toBe(200);
    const res = await handleRequest(put("big.png", MB + 1), deps);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large", limitBytes: MB });
    expect(r2.store.has("users/alice/big.png")).toBe(false);
  });

  it("rejects empty bodies", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(put("a.png", 0), deps)).status).toBe(400);
  });

  it("honors ifAbsent=1 with 409 already_exists", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(put("a.png", 3, "image/png", { query: "?ifAbsent=1" }), deps)).status).toBe(200);
    const res = await handleRequest(put("a.png", 3, "image/png", { query: "?ifAbsent=1" }), deps);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_exists");
  });
});

describe("files: get, list, delete", () => {
  it("streams the bytes with the stored type and private, nosniff headers", async () => {
    const { deps } = makeDeps();
    await handleRequest(put("a.png", 5), deps);
    const res = await handleRequest(req("GET", filePath("a.png")), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(5));
  });

  it("serves SVG with a sandboxing CSP as an attachment", async () => {
    const { deps } = makeDeps();
    await handleRequest(put("x.svg", 5, "image/svg+xml"), deps);
    const res = await handleRequest(req("GET", filePath("x.svg")), deps);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it("404s missing files", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(req("GET", filePath("nope.png")), deps)).status).toBe(404);
  });

  it("lists files with metadata, filtered by prefix", async () => {
    const { deps } = makeDeps();
    await handleRequest(put("A/.attachments/x.png", 3), deps);
    await handleRequest(put("A/Doc.pdf", 7, "application/pdf"), deps);
    await handleRequest(put("B/y.png", 2), deps);
    const all = (await (await handleRequest(req("GET", "/v1/files"), deps)).json()) as {
      files: { path: string; size: number; contentType: string; uploaded: string }[];
    };
    expect(all.files.map((f) => f.path)).toEqual(["A/.attachments/x.png", "A/Doc.pdf", "B/y.png"]);
    expect(all.files[1]).toEqual({
      path: "A/Doc.pdf",
      size: 7,
      contentType: "application/pdf",
      uploaded: "2026-11-14T00:00:00.000Z",
    });
    const a = (await (await handleRequest(req("GET", "/v1/files", { query: "?prefix=A/" }), deps)).json()) as {
      files: { path: string }[];
    };
    expect(a.files.map((f) => f.path)).toEqual(["A/.attachments/x.png", "A/Doc.pdf"]);
  });

  it("deletes one file, or a folder only with recursive=1", async () => {
    const { deps, r2 } = makeDeps();
    await handleRequest(put("A/x.png", 3), deps);
    await handleRequest(put("A/.attachments/y.png", 4), deps);
    await handleRequest(put("AB/z.png", 5), deps);
    expect(await (await handleRequest(req("DELETE", filePath("A")), deps)).json()).toEqual({ deleted: 0, truncated: false });
    expect(r2.store.size).toBe(3);
    const res = await handleRequest(req("DELETE", filePath("A"), { query: "?recursive=1" }), deps);
    expect(await res.json()).toEqual({ deleted: 2, truncated: false });
    expect([...r2.store.keys()]).toEqual(["users/alice/AB/z.png"]);
    expect(await (await handleRequest(req("DELETE", filePath("AB/z.png")), deps)).json()).toEqual({ deleted: 1, truncated: false });
    expect(r2.store.size).toBe(0);
  });
});

describe("files: storage quota accounting", () => {
  it("reports usage and limit from STORAGE_QUOTA_MB", async () => {
    const { deps } = makeDeps({ env: { STORAGE_QUOTA_MB: "2" } });
    expect(await storage(deps)).toEqual({ usedBytes: 0, limitBytes: 2 * MB });
    await handleRequest(put("a.png", 1000), deps);
    expect(await storage(deps)).toEqual({ usedBytes: 1000, limitBytes: 2 * MB });
  });

  it("charges only the difference on overwrite (up and down)", async () => {
    const { deps, sqlite } = makeDeps();
    await handleRequest(put("a.png", 1000), deps);
    await handleRequest(put("a.png", 1500), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(1500);
    await handleRequest(put("a.png", 200), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(200);
  });

  it("rejects over-quota uploads with 413 storage_quota_exceeded and stores nothing", async () => {
    const { deps, r2 } = makeDeps({ env: { STORAGE_QUOTA_MB: "1", MAX_FILE_MB: "5" } });
    expect((await handleRequest(put("a.png", MB - 10), deps)).status).toBe(200);
    const res = await handleRequest(put("b.png", 11), deps);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "storage_quota_exceeded", usedBytes: MB - 10, limitBytes: MB });
    expect(r2.store.has("users/alice/b.png")).toBe(false);
    // Exactly filling the quota is fine, and shrinking an existing file always is.
    expect((await handleRequest(put("b.png", 10), deps)).status).toBe(200);
    expect((await handleRequest(put("a.png", 5), deps)).status).toBe(200);
    expect((await storage(deps)).usedBytes).toBe(15);
  });

  it("frees usage on delete (single and recursive)", async () => {
    const { deps, sqlite } = makeDeps();
    await handleRequest(put("A/x.png", 100), deps);
    await handleRequest(put("A/y.png", 50), deps);
    await handleRequest(put("z.png", 7), deps);
    await handleRequest(req("DELETE", filePath("z.png")), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(150);
    await handleRequest(req("DELETE", filePath("A"), { query: "?recursive=1" }), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(0);
  });

  it("keeps usage per user", async () => {
    const { deps, sqlite } = makeDeps();
    await handleRequest(put("a.png", 10), deps);
    await handleRequest(put("a.png", 20, "image/png", { token: "good:bob" }), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(10);
    expect(storageUsedFor(sqlite, "bob")).toBe(20);
  });
});

describe("files: move", () => {
  const move = (from: string, to: string) =>
    req("POST", "/v1/files/move", { body: JSON.stringify({ from, to }), type: "application/json" });

  it("moves one file and keeps usage unchanged", async () => {
    const { deps, r2, sqlite } = makeDeps();
    await handleRequest(put("Doc.pdf", 30, "application/pdf"), deps);
    const res = await handleRequest(move("Doc.pdf", "Folder/Renamed.pdf"), deps);
    expect(await res.json()).toEqual({ moved: 1, truncated: false });
    expect([...r2.store.keys()]).toEqual(["users/alice/Folder/Renamed.pdf"]);
    expect(r2.store.get("users/alice/Folder/Renamed.pdf")?.contentType).toBe("application/pdf");
    expect(storageUsedFor(sqlite, "alice")).toBe(30);
  });

  it("subtracts a replaced destination", async () => {
    const { deps, sqlite } = makeDeps();
    await handleRequest(put("a.png", 30), deps);
    await handleRequest(put("b.png", 12), deps);
    await handleRequest(move("a.png", "b.png"), deps);
    expect(storageUsedFor(sqlite, "alice")).toBe(30);
  });

  it("refuses to change the file type", async () => {
    const { deps } = makeDeps();
    await handleRequest(put("a.pdf", 3, "application/pdf"), deps);
    expect((await handleRequest(move("a.pdf", "a.png"), deps)).status).toBe(415);
  });

  it("moves a folder prefix (and not sibling prefixes)", async () => {
    const { deps, r2, sqlite } = makeDeps();
    await handleRequest(put("A/.attachments/x.png", 3), deps);
    await handleRequest(put("A/Sub/Doc.pdf", 4, "application/pdf"), deps);
    await handleRequest(put("AB/keep.png", 5), deps);
    const res = await handleRequest(move("A", "Z/A2"), deps);
    expect(await res.json()).toEqual({ moved: 2, truncated: false });
    expect([...r2.store.keys()].sort()).toEqual([
      "users/alice/AB/keep.png",
      "users/alice/Z/A2/.attachments/x.png",
      "users/alice/Z/A2/Sub/Doc.pdf",
    ]);
    expect(storageUsedFor(sqlite, "alice")).toBe(12);
  });

  it("reports truncated when a folder has more than one batch", async () => {
    const { deps, r2 } = makeDeps();
    for (let i = 0; i < 101; i += 1) await handleRequest(put(`A/${i}.png`, 1), deps);
    const first = (await (await handleRequest(move("A", "B"), deps)).json()) as { moved: number; truncated: boolean };
    expect(first).toEqual({ moved: 100, truncated: true });
    const second = (await (await handleRequest(move("A", "B"), deps)).json()) as { moved: number; truncated: boolean };
    expect(second).toEqual({ moved: 1, truncated: false });
    expect([...r2.store.keys()].every((k) => k.startsWith("users/alice/B/"))).toBe(true);
  });

  it("rejects moving a folder into itself and bad bodies", async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(move("A", "A/B"), deps)).status).toBe(400);
    const bad = req("POST", "/v1/files/move", { body: "nope", type: "application/json" });
    expect((await handleRequest(bad, deps)).status).toBe(400);
  });

  it("is a no-op for a missing source", async () => {
    const { deps } = makeDeps();
    expect(await (await handleRequest(move("nope", "other"), deps)).json()).toEqual({ moved: 0, truncated: false });
  });
});
