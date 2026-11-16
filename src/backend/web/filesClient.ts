/**
 * Typed client for the proxy Worker's file storage (`/v1/files`, `/v1/storage`),
 * which keeps web images and PDFs in R2. Shares the AI client's transport
 * (token injection, network/abort mapping), with file-specific error messages.
 */

import { createProxyRequest, type AiProxyClientOptions, type AiProxyErrorCode, type ProxyRequest, type ProxyRequestInit } from './aiProxyClient';
import { getWebIdToken } from './index';

export interface StoredFile {
  path: string;
  size: number;
  contentType: string;
  uploaded: string;
}

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
}

export type FilesErrorCode =
  | 'unauthorized'
  | 'storage_quota_exceeded'
  | 'too_large'
  | 'unsupported_type'
  | 'already_exists'
  | 'not_found'
  | 'bad_path'
  | 'bad_request'
  | 'files_unavailable'
  | 'network_error'
  | 'aborted'
  | 'bad_response'
  | AiProxyErrorCode;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** User-facing text for a files error code. */
export function filesErrorMessage(
  code: FilesErrorCode,
  extra: { usage?: StorageUsage; limitBytes?: number; status?: number } = {},
): string {
  switch (code) {
    case 'unauthorized':
      return 'Sign in to upload images and PDFs.';
    case 'storage_quota_exceeded':
      return extra.usage
        ? `Your file storage is full (${formatBytes(extra.usage.usedBytes)} of ${formatBytes(extra.usage.limitBytes)}). Delete some images or PDFs to make room.`
        : 'Your file storage is full. Delete some images or PDFs to make room.';
    case 'too_large':
      return extra.limitBytes ? `That file is larger than ${formatBytes(extra.limitBytes)}.` : 'That file is too large.';
    case 'unsupported_type':
      return 'Only PNG, JPEG, GIF, WebP, SVG images and PDFs can be uploaded.';
    case 'already_exists':
      return 'A file with that name already exists.';
    case 'not_found':
      return 'That file no longer exists.';
    case 'bad_path':
      return 'That file name is not allowed.';
    case 'files_unavailable':
      return 'File storage is not set up on the server yet.';
    case 'network_error':
      return "Couldn't reach file storage. Check your connection.";
    case 'aborted':
      return 'Upload cancelled.';
    case 'bad_response':
      return 'File storage returned an unexpected response.';
    default:
      return `File request failed${extra.status ? ` (${extra.status})` : ''}.`;
  }
}

export class FilesError extends Error {
  readonly code: FilesErrorCode;
  readonly status: number;
  readonly usage?: StorageUsage;
  readonly limitBytes?: number;
  readonly detail?: string;

  constructor(code: FilesErrorCode, status: number, opts: { usage?: StorageUsage; limitBytes?: number; detail?: string } = {}) {
    super(filesErrorMessage(code, { ...opts, status }));
    this.name = 'FilesError';
    this.code = code;
    this.status = status;
    this.usage = opts.usage;
    this.limitBytes = opts.limitBytes;
    this.detail = opts.detail;
  }
}

function asUsage(value: unknown): StorageUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.usedBytes !== 'number' || typeof v.limitBytes !== 'number') return undefined;
  return { usedBytes: v.usedBytes, limitBytes: v.limitBytes };
}

export function filesErrorFromBody(status: number, body: unknown): FilesError {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof b.error === 'string' ? b.error : status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : `http_${status}`;
  return new FilesError(code, status, {
    usage: code === 'storage_quota_exceeded' ? asUsage(b) : undefined,
    limitBytes: typeof b.limitBytes === 'number' ? b.limitBytes : undefined,
    detail: typeof b.detail === 'string' ? b.detail : undefined,
  });
}

/** What the cloud vault needs from file storage (FilesClient, or an in-memory fake). */
export interface CloudFiles {
  put(path: string, data: Uint8Array | Blob, contentType: string, opts?: { ifAbsent?: boolean }): Promise<StoredFile>;
  getBytes(path: string): Promise<Uint8Array>;
  /** Deletes one file; with `recursive`, everything under `path/` when no file is at `path`. */
  remove(path: string, opts?: { recursive?: boolean }): Promise<number>;
  list(prefix?: string): Promise<StoredFile[]>;
  /** Moves one file, or every file under the folder `from/` to `to/`. */
  move(from: string, to: string): Promise<number>;
}

const encodePath = (path: string) => encodeURIComponent(path);

/** Guards against a server that keeps answering `truncated` forever. */
const MAX_BATCH_ROUNDS = 100;

export class FilesClient implements CloudFiles {
  private readonly request: ProxyRequest;

  constructor(options: AiProxyClientOptions) {
    this.request = createProxyRequest(options);
  }

  private call(path: string, init: ProxyRequestInit): Promise<Response> {
    return this.request(path, {
      ...init,
      errorFromBody: filesErrorFromBody,
      makeError: (code, status, detail) => new FilesError(code, status, { detail }),
    });
  }

  private async jsonOf<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body || typeof body !== 'object') throw new FilesError('bad_response', res.status);
    return body;
  }

  async put(path: string, data: Uint8Array | Blob, contentType: string, opts: { ifAbsent?: boolean } = {}): Promise<StoredFile> {
    const res = await this.call(`/v1/files/${encodePath(path)}${opts.ifAbsent ? '?ifAbsent=1' : ''}`, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: data as BodyInit,
    });
    return this.jsonOf<StoredFile>(res);
  }

  async getBlob(path: string, opts: { signal?: AbortSignal } = {}): Promise<Blob> {
    const res = await this.call(`/v1/files/${encodePath(path)}`, { method: 'GET', signal: opts.signal });
    return res.blob();
  }

  async getBytes(path: string, opts: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
    const res = await this.call(`/v1/files/${encodePath(path)}`, { method: 'GET', signal: opts.signal });
    return new Uint8Array(await res.arrayBuffer());
  }

  async remove(path: string, opts: { recursive?: boolean } = {}): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_BATCH_ROUNDS; round += 1) {
      const res = await this.call(`/v1/files/${encodePath(path)}${opts.recursive ? '?recursive=1' : ''}`, { method: 'DELETE' });
      const body = await this.jsonOf<{ deleted?: number; truncated?: boolean }>(res);
      total += body.deleted ?? 0;
      if (!body.truncated) break;
    }
    return total;
  }

  async list(prefix = ''): Promise<StoredFile[]> {
    const res = await this.call(`/v1/files${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`, { method: 'GET' });
    const body = await this.jsonOf<{ files?: StoredFile[] }>(res);
    return Array.isArray(body.files) ? body.files : [];
  }

  async move(from: string, to: string): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_BATCH_ROUNDS; round += 1) {
      const res = await this.call('/v1/files/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const body = await this.jsonOf<{ moved?: number; truncated?: boolean }>(res);
      total += body.moved ?? 0;
      if (!body.truncated) break;
    }
    return total;
  }

  async storage(): Promise<StorageUsage> {
    const res = await this.call('/v1/storage', { method: 'GET' });
    const usage = asUsage(await res.json().catch(() => null));
    if (!usage) throw new FilesError('bad_response', res.status);
    return usage;
  }
}

let filesClient: FilesClient | null = null;

/** Shared files client (null when `VITE_AI_PROXY_URL` is unset). */
export function getFilesClient(): FilesClient | null {
  const baseUrl = import.meta.env?.VITE_AI_PROXY_URL?.trim();
  if (!baseUrl) return null;
  filesClient ??= new FilesClient({ baseUrl, getIdToken: getWebIdToken });
  return filesClient;
}
