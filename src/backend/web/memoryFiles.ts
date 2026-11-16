/**
 * In-memory `CloudFiles` for the browser demo mode (no Worker) and tests.
 * Same semantics as the Worker's `/v1/files` routes, minus quotas.
 */

import { FilesError, type CloudFiles, type StoredFile } from './filesClient';

interface Entry {
  bytes: Uint8Array;
  contentType: string;
  uploaded: string;
}

export class InMemoryFiles implements CloudFiles {
  readonly entries = new Map<string, Entry>();

  async put(path: string, data: Uint8Array | Blob, contentType: string, opts: { ifAbsent?: boolean } = {}): Promise<StoredFile> {
    if (opts.ifAbsent && this.entries.has(path)) throw new FilesError('already_exists', 409);
    const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(await data.arrayBuffer());
    const entry = { bytes, contentType, uploaded: new Date().toISOString() };
    this.entries.set(path, entry);
    return { path, size: bytes.byteLength, contentType, uploaded: entry.uploaded };
  }

  async getBytes(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (!entry) throw new FilesError('not_found', 404);
    return entry.bytes.slice();
  }

  async remove(path: string, opts: { recursive?: boolean } = {}): Promise<number> {
    if (this.entries.delete(path)) return 1;
    if (!opts.recursive) return 0;
    let n = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${path}/`)) {
        this.entries.delete(key);
        n += 1;
      }
    }
    return n;
  }

  async list(prefix = ''): Promise<StoredFile[]> {
    return [...this.entries]
      .filter(([path]) => path.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, e]) => ({ path, size: e.bytes.byteLength, contentType: e.contentType, uploaded: e.uploaded }));
  }

  async move(from: string, to: string): Promise<number> {
    const exact = this.entries.get(from);
    if (exact) {
      this.entries.delete(from);
      this.entries.set(to, exact);
      return 1;
    }
    let n = 0;
    for (const [key, entry] of [...this.entries]) {
      if (!key.startsWith(`${from}/`)) continue;
      this.entries.delete(key);
      this.entries.set(`${to}/${key.slice(from.length + 1)}`, entry);
      n += 1;
    }
    return n;
  }
}
