/**
 * Per-user file storage (images, PDFs and .pptx decks) in R2, behind the same Firebase auth
 * as the AI routes. Objects are keyed `users/<uid>/<vault-relative path>`; the
 * uid always comes from the verified token. Byte usage is tracked in D1
 * (`storage_usage`) and is completely separate from the AI request quota.
 */
import type { Config } from "./config";
import { json, type Cors } from "./http";
import type { StorageInfo, StorageStore } from "./storage";

export interface FilesDeps {
  bucket: R2Bucket;
  storage: StorageStore;
}

export const MAX_PATH_LENGTH = 1024;
/** Objects returned by one `GET /v1/files` (R2 lists 1000 per call). */
export const MAX_LIST_OBJECTS = 10_000;
/** Objects moved per `POST /v1/files/move` call (each costs ~4 R2 operations). */
export const MAX_MOVE_BATCH = 100;
/** Objects deleted per recursive `DELETE` call (one R2 batch delete). */
export const MAX_DELETE_BATCH = 1000;

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const ALLOWED_TYPES = new Set(Object.values(TYPE_BY_EXT));

export class BadPath extends Error {}

/**
 * Validates a vault-relative path: no absolute paths, backslashes, control
 * characters, empty / `.` / `..` segments, and at most MAX_PATH_LENGTH chars.
 */
export function sanitizePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new BadPath("path is empty");
  if (raw.length > MAX_PATH_LENGTH) throw new BadPath("path is too long");
  if (raw.startsWith("/")) throw new BadPath("path must be relative");
  if (raw.includes("\\")) throw new BadPath("path must use '/'");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new BadPath("path has control characters");
  for (const segment of raw.split("/")) {
    if (segment === "") throw new BadPath("path has an empty segment");
    if (segment === "." || segment === "..") throw new BadPath("path has a '.' or '..' segment");
  }
  return raw;
}

/** Content type implied by the path's extension, or null when not allowed. */
export function contentTypeFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return TYPE_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}

function userPrefix(uid: string): string {
  return `users/${uid}/`;
}

interface FileCtx {
  uid: string;
  config: Config;
  files: FilesDeps;
  cors: Cors;
}

export function storageInfo(usedBytes: number, config: Config): StorageInfo {
  return { usedBytes, limitBytes: config.storageQuotaBytes };
}

function badPath(err: BadPath, cors: Cors): Response {
  return json(400, { error: "bad_path", detail: err.message }, cors);
}

/** Routes `/v1/storage`, `/v1/files`, `/v1/files/move` and `/v1/files/<path>`. */
export async function handleFiles(req: Request, url: URL, ctx: FileCtx): Promise<Response> {
  const { cors } = ctx;
  try {
    if (url.pathname === "/v1/storage") {
      return json(200, storageInfo(await ctx.files.storage.getUsed(ctx.uid), ctx.config), cors);
    }
    if (url.pathname === "/v1/files") return await listFiles(url, ctx);
    if (url.pathname === "/v1/files/move" && req.method === "POST") return await moveFiles(req, ctx);

    let path: string;
    try {
      let raw: string;
      try {
        raw = decodeURIComponent(url.pathname.slice("/v1/files/".length));
      } catch {
        throw new BadPath("path is not valid percent-encoding");
      }
      path = sanitizePath(raw);
    } catch (err) {
      if (err instanceof BadPath) return badPath(err, cors);
      throw err;
    }
    const key = userPrefix(ctx.uid) + path;
    if (req.method === "PUT") return await putFile(req, url, path, key, ctx);
    if (req.method === "GET") return await getFile(path, key, ctx);
    return await deleteFile(url, key, ctx);
  } catch (err) {
    if (err instanceof BadPath) return badPath(err, cors);
    throw err;
  }
}

/** Methods allowed per files route, or null when the path is not a files route. */
export function filesRouteMethods(pathname: string): string[] | null {
  if (pathname === "/v1/storage") return ["GET"];
  if (pathname === "/v1/files") return ["GET"];
  if (pathname === "/v1/files/move") return ["POST", "GET", "PUT", "DELETE"];
  if (pathname.startsWith("/v1/files/")) return ["GET", "PUT", "DELETE"];
  return null;
}

async function putFile(req: Request, url: URL, path: string, key: string, ctx: FileCtx): Promise<Response> {
  const { config, files, cors, uid } = ctx;
  const expected = contentTypeFor(path);
  const declaredType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!expected || declaredType !== expected) {
    return json(
      415,
      { error: "unsupported_type", detail: expected ? `expected ${expected}` : "only images, PDFs and .pptx decks are allowed" },
      cors,
    );
  }

  const limitBytes = config.maxFileBytes;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limitBytes) return json(413, { error: "too_large", limitBytes }, cors);
  const body = await req.arrayBuffer();
  if (body.byteLength > limitBytes) return json(413, { error: "too_large", limitBytes }, cors);
  if (body.byteLength === 0) return json(400, { error: "bad_request", detail: "empty body" }, cors);

  const existing = await files.bucket.head(key);
  if (existing && url.searchParams.get("ifAbsent") === "1") {
    return json(409, { error: "already_exists" }, cors);
  }

  // Overwrites only charge the difference.
  const delta = body.byteLength - (existing?.size ?? 0);
  if (delta > 0) {
    const reservation = await files.storage.reserve(uid, delta, config.storageQuotaBytes);
    if (!reservation.ok) {
      return json(413, { error: "storage_quota_exceeded", ...storageInfo(reservation.usedBytes, config) }, cors);
    }
  }
  let stored: R2Object;
  try {
    stored = await files.bucket.put(key, body, { httpMetadata: { contentType: expected } });
  } catch (err) {
    if (delta > 0) await files.storage.adjust(uid, -delta);
    throw err;
  }
  if (delta < 0) await files.storage.adjust(uid, delta);

  return json(
    200,
    { path, size: body.byteLength, contentType: expected, uploaded: stored.uploaded.toISOString() },
    cors,
  );
}

async function getFile(path: string, key: string, ctx: FileCtx): Promise<Response> {
  const obj = await ctx.files.bucket.get(key);
  if (!obj) return json(404, { error: "not_found" }, ctx.cors);
  const contentType = obj.httpMetadata?.contentType || contentTypeFor(path) || "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-length": String(obj.size),
    "cache-control": "private, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
    ...ctx.cors,
  };
  if (contentType === "image/svg+xml") {
    // An SVG opened directly could run script on the Worker origin; neuter it.
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    headers["content-disposition"] = "attachment";
  }
  return new Response(obj.body, { status: 200, headers });
}

async function deleteFile(url: URL, key: string, ctx: FileCtx): Promise<Response> {
  const { files, uid, cors } = ctx;
  const exact = await files.bucket.head(key);
  if (exact) {
    await files.bucket.delete(key);
    await files.storage.adjust(uid, -exact.size);
    return json(200, { deleted: 1, truncated: false }, cors);
  }
  if (url.searchParams.get("recursive") !== "1") return json(200, { deleted: 0, truncated: false }, cors);
  const listed = await files.bucket.list({ prefix: `${key}/`, limit: MAX_DELETE_BATCH });
  if (listed.objects.length) {
    await files.bucket.delete(listed.objects.map((o) => o.key));
    await files.storage.adjust(uid, -listed.objects.reduce((sum, o) => sum + o.size, 0));
  }
  return json(200, { deleted: listed.objects.length, truncated: listed.truncated }, cors);
}

async function listFiles(url: URL, ctx: FileCtx): Promise<Response> {
  const { files, uid, cors } = ctx;
  const rawPrefix = url.searchParams.get("prefix") ?? "";
  if (rawPrefix) sanitizePath(rawPrefix.endsWith("/") ? rawPrefix.slice(0, -1) : rawPrefix);
  const base = userPrefix(uid);
  const out: { path: string; size: number; contentType: string; uploaded: string }[] = [];
  let cursor: string | undefined;
  let truncated = false;
  do {
    const page = await files.bucket.list({
      prefix: base + rawPrefix,
      cursor,
      limit: 1000,
      include: ["httpMetadata"],
    });
    for (const o of page.objects) {
      const path = o.key.slice(base.length);
      out.push({
        path,
        size: o.size,
        contentType: o.httpMetadata?.contentType || contentTypeFor(path) || "application/octet-stream",
        uploaded: o.uploaded.toISOString(),
      });
    }
    truncated = page.truncated;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && out.length < MAX_LIST_OBJECTS);
  return json(200, { files: out, truncated }, cors);
}

async function moveFiles(req: Request, ctx: FileCtx): Promise<Response> {
  const { files, uid, cors } = ctx;
  let body: Record<string, unknown>;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_request", detail: "body must be JSON {from, to}" }, cors);
  }
  const from = sanitizePath(body.from);
  const to = sanitizePath(body.to);
  if (from === to) return json(200, { moved: 0, truncated: false }, cors);
  if (to.startsWith(`${from}/`)) {
    return json(400, { error: "bad_request", detail: "cannot move a folder into itself" }, cors);
  }

  const base = userPrefix(uid);
  const moveOne = async (srcKey: string, destKey: string) => {
    const src = await files.bucket.get(srcKey);
    if (!src) return false;
    const replaced = await files.bucket.head(destKey);
    const bytes = await src.arrayBuffer();
    await files.bucket.put(destKey, bytes, { httpMetadata: { contentType: src.httpMetadata?.contentType } });
    await files.bucket.delete(srcKey);
    // The source bytes are now counted at the destination; whatever it replaced is gone.
    if (replaced) await files.storage.adjust(uid, -replaced.size);
    return true;
  };

  const exact = await files.bucket.head(base + from);
  if (exact) {
    const type = exact.httpMetadata?.contentType ?? contentTypeFor(from);
    if (contentTypeFor(to) !== type) {
      return json(415, { error: "unsupported_type", detail: "the new name must keep the file type" }, cors);
    }
    const moved = await moveOne(base + from, base + to);
    return json(200, { moved: moved ? 1 : 0, truncated: false }, cors);
  }

  // Folder: move up to one batch; moved objects leave the prefix, so callers
  // repeat while `truncated` is true.
  const listed = await files.bucket.list({ prefix: `${base}${from}/`, limit: MAX_MOVE_BATCH });
  let moved = 0;
  for (const o of listed.objects) {
    const rest = o.key.slice(`${base}${from}/`.length);
    if (await moveOne(o.key, `${base}${to}/${rest}`)) moved += 1;
  }
  return json(200, { moved, truncated: listed.truncated }, cors);
}
