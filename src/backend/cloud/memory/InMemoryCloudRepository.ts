/**
 * In-memory CloudRepository: the reference implementation for the contract
 * tests and the backing store for a signed-out browser demo. Same semantics
 * as the Firebase implementation, including the per-record size limit.
 */

import {
  MAX_PAYLOAD_BYTES,
  type CloudRepository,
  type CloudTree,
  type CloudWatchCallback,
  type CloudWatchEvent,
  type CreateShareInput,
  type JsonValue,
  type ShareMeta,
  type ShareRecord,
  type Unsubscribe,
  type WorkspaceExport,
  type WorkspaceId,
} from '../CloudRepository';
import { ConflictError, InvalidPathError, NotFoundError, PayloadTooLargeError, PermissionError } from '../errors';
import {
  ancestorFolders,
  byteLength,
  ensureMdExtension,
  isUnder,
  normalizePath,
  noteTitle,
  reprefix,
} from '../paths';

interface MemNote {
  id: string;
  path: string;
  body: string;
  updatedAt: string;
}

interface MemWorkspace {
  notes: Map<string, MemNote>;
  folders: Set<string>;
  data: Map<string, string>;
}

export interface InMemoryCloudRepositoryOptions {
  /** Defaults to MAX_PAYLOAD_BYTES (900 KB). */
  maxPayloadBytes?: number;
  /** Clock override for deterministic tests. */
  now?: () => Date;
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export class InMemoryCloudRepository implements CloudRepository {
  private readonly workspaces = new Map<WorkspaceId, MemWorkspace>();
  private readonly shares = new Map<string, ShareRecord>();
  private readonly watchers = new Map<WorkspaceId, Set<CloudWatchCallback>>();
  private readonly maxBytes: number;
  private readonly now: () => Date;

  constructor(options: InMemoryCloudRepositoryOptions = {}) {
    this.maxBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  // ── Notes & folders ──────────────────────────────────────────────────────

  async listTree(ws: WorkspaceId): Promise<CloudTree> {
    const w = this.ws(ws);
    const notes = [...w.notes.values()]
      .map((n) => ({ id: n.id, path: n.path, updatedAt: n.updatedAt, size: byteLength(n.body) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const folders = new Set(w.folders);
    for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
    return { notes, folders: [...folders].sort() };
  }

  async readNote(ws: WorkspaceId, path: string): Promise<string | null> {
    return this.findNote(this.ws(ws), normalizePath(path))?.body ?? null;
  }

  async writeNote(ws: WorkspaceId, path: string, body: string): Promise<void> {
    const p = normalizePath(path);
    this.checkSize(p, body);
    const w = this.ws(ws);
    const existing = this.findNote(w, p);
    const events: CloudWatchEvent[] = [];
    if (existing) {
      existing.body = body;
      existing.updatedAt = this.stamp();
      events.push({ type: 'change', path: p });
    } else {
      events.push(...this.ensureFolders(w, ancestorFolders(p)));
      const id = newId('n');
      w.notes.set(id, { id, path: p, body, updatedAt: this.stamp() });
      events.push({ type: 'add', path: p });
    }
    this.emit(ws, events);
  }

  async createNote(ws: WorkspaceId, name: string, body?: string): Promise<string> {
    const p = ensureMdExtension(normalizePath(name));
    const text = body ?? `# ${noteTitle(p)}\n\n`;
    this.checkSize(p, text);
    const w = this.ws(ws);
    if (this.findNote(w, p)) throw new ConflictError(`A note already exists at "${p}"`);
    const events = this.ensureFolders(w, ancestorFolders(p));
    const id = newId('n');
    w.notes.set(id, { id, path: p, body: text, updatedAt: this.stamp() });
    events.push({ type: 'add', path: p });
    this.emit(ws, events);
    return p;
  }

  async mkdir(ws: WorkspaceId, path: string): Promise<string> {
    const p = normalizePath(path);
    const w = this.ws(ws);
    this.emit(ws, this.ensureFolders(w, [...ancestorFolders(p), p]));
    return p;
  }

  async rename(ws: WorkspaceId, from: string, to: string): Promise<string> {
    const src = normalizePath(from);
    const w = this.ws(ws);
    const note = this.findNote(w, src);
    if (note) {
      const dest = ensureMdExtension(normalizePath(to));
      if (dest === src) return src;
      if (this.findNote(w, dest) || this.folderExists(w, dest)) {
        throw new ConflictError(`"${dest}" already exists`);
      }
      const events = this.ensureFolders(w, ancestorFolders(dest));
      note.path = dest;
      note.updatedAt = this.stamp();
      events.push({ type: 'unlink', path: src }, { type: 'add', path: dest });
      this.emit(ws, events);
      return dest;
    }

    if (!this.folderExists(w, src)) throw new NotFoundError(`Nothing exists at "${src}"`);
    const dest = normalizePath(to);
    if (dest === src) return src;
    if (isUnder(dest, src)) throw new InvalidPathError(`Cannot move "${src}" into itself`);
    if (this.findNote(w, dest) || this.folderExists(w, dest)) {
      throw new ConflictError(`"${dest}" already exists`);
    }

    const events = this.ensureFolders(w, ancestorFolders(dest));
    const stamp = this.stamp();
    for (const n of w.notes.values()) {
      if (!isUnder(n.path, src)) continue;
      const next = reprefix(n.path, src, dest);
      events.push({ type: 'unlink', path: n.path }, { type: 'add', path: next });
      n.path = next;
      n.updatedAt = stamp;
    }
    const moved = [...w.folders].filter((f) => f === src || isUnder(f, src)).sort();
    for (const f of moved) w.folders.delete(f);
    for (const f of moved) {
      const next = reprefix(f, src, dest);
      w.folders.add(next);
      events.push({ type: 'unlinkDir', path: f }, { type: 'addDir', path: next });
    }
    if (!w.folders.has(dest)) {
      // `src` was only implied by its notes; keep `dest` as an explicit folder.
      w.folders.add(dest);
    }
    this.emit(ws, events);
    return dest;
  }

  async remove(ws: WorkspaceId, path: string): Promise<void> {
    const p = normalizePath(path);
    const w = this.ws(ws);
    const note = this.findNote(w, p);
    if (note) {
      w.notes.delete(note.id);
      this.emit(ws, [{ type: 'unlink', path: p }]);
      return;
    }
    if (!this.folderExists(w, p)) throw new NotFoundError(`Nothing exists at "${p}"`);
    const events: CloudWatchEvent[] = [];
    for (const n of [...w.notes.values()]) {
      if (!isUnder(n.path, p)) continue;
      w.notes.delete(n.id);
      events.push({ type: 'unlink', path: n.path });
    }
    const folders = [...w.folders].filter((f) => f === p || isUnder(f, p)).sort().reverse();
    for (const f of folders) {
      w.folders.delete(f);
      events.push({ type: 'unlinkDir', path: f });
    }
    this.emit(ws, events);
  }

  // ── App data ─────────────────────────────────────────────────────────────

  async readData(ws: WorkspaceId, key: string): Promise<string | null> {
    return this.ws(ws).data.get(requireKey(key)) ?? null;
  }

  async writeData(ws: WorkspaceId, key: string, text: string): Promise<void> {
    const k = requireKey(key);
    this.checkSize(k, text);
    this.ws(ws).data.set(k, text);
  }

  async appendData(ws: WorkspaceId, key: string, line: string): Promise<void> {
    const k = requireKey(key);
    this.checkSize(k, line);
    const data = this.ws(ws).data;
    data.set(k, (data.get(k) ?? '') + line);
  }

  async deleteData(ws: WorkspaceId, key: string): Promise<void> {
    this.ws(ws).data.delete(requireKey(key));
  }

  // ── Change feed ──────────────────────────────────────────────────────────

  watch(ws: WorkspaceId, cb: CloudWatchCallback): Unsubscribe {
    let set = this.watchers.get(ws);
    if (!set) {
      set = new Set();
      this.watchers.set(ws, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  // ── Sharing ──────────────────────────────────────────────────────────────

  async createShare(ownerWs: WorkspaceId, input: CreateShareInput): Promise<{ shareId: string }> {
    if (!ownerWs) throw new PermissionError('Sign in to share');
    const json = JSON.stringify(input.payload ?? null);
    this.checkSize(`share "${input.title}"`, json);
    const shareId = newId('s');
    this.shares.set(shareId, {
      shareId,
      ownerWs,
      kind: input.kind,
      title: input.title,
      payload: JSON.parse(json) as JsonValue,
      createdAt: this.stamp(),
    });
    return { shareId };
  }

  async getShare(shareId: string): Promise<ShareRecord | null> {
    const share = this.shares.get(shareId);
    return share ? { ...share, payload: structuredCloneJson(share.payload) } : null;
  }

  async listMyShares(ownerWs: WorkspaceId): Promise<ShareMeta[]> {
    return [...this.shares.values()]
      .filter((s) => s.ownerWs === ownerWs)
      .map(({ payload: _payload, ...meta }) => meta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.shareId.localeCompare(a.shareId));
  }

  async deleteShare(ownerWs: WorkspaceId, shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (!share) throw new NotFoundError(`Share "${shareId}" not found`);
    if (share.ownerWs !== ownerWs) throw new PermissionError('Only the owner can delete a share');
    this.shares.delete(shareId);
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async exportWorkspace(ws: WorkspaceId): Promise<WorkspaceExport> {
    const w = this.ws(ws);
    return {
      notes: [...w.notes.values()]
        .map((n) => ({ path: n.path, body: n.body }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      folders: [...w.folders].sort(),
      data: [...w.data.entries()].map(([key, text]) => ({ key, text })).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private ws(ws: WorkspaceId): MemWorkspace {
    if (!ws) throw new PermissionError('No workspace (not signed in)');
    let w = this.workspaces.get(ws);
    if (!w) {
      w = { notes: new Map(), folders: new Set(), data: new Map() };
      this.workspaces.set(ws, w);
    }
    return w;
  }

  private findNote(w: MemWorkspace, path: string): MemNote | undefined {
    for (const n of w.notes.values()) if (n.path === path) return n;
    return undefined;
  }

  private folderExists(w: MemWorkspace, path: string): boolean {
    if (w.folders.has(path)) return true;
    for (const n of w.notes.values()) if (isUnder(n.path, path)) return true;
    return false;
  }

  private ensureFolders(w: MemWorkspace, folders: string[]): CloudWatchEvent[] {
    const events: CloudWatchEvent[] = [];
    for (const f of folders) {
      if (w.folders.has(f)) continue;
      w.folders.add(f);
      events.push({ type: 'addDir', path: f });
    }
    return events;
  }

  private checkSize(target: string, text: string): void {
    const bytes = byteLength(text);
    if (bytes > this.maxBytes) throw new PayloadTooLargeError(target, bytes, this.maxBytes);
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private emit(ws: WorkspaceId, events: CloudWatchEvent[]): void {
    const set = this.watchers.get(ws);
    if (!set?.size || !events.length) return;
    const listeners = [...set];
    // Async like a real backend, so callers never re-enter mid-mutation.
    queueMicrotask(() => {
      for (const event of events) for (const cb of listeners) cb(event);
    });
  }
}

function requireKey(key: string): string {
  if (typeof key !== 'string' || !key) throw new InvalidPathError('Data key is empty');
  return key;
}

function structuredCloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
