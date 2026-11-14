/**
 * Adapter from the vendor-neutral `CloudRepository` to the app's path-based
 * vault API (`VaultBackend`, the shape of the desktop preload bridge), so the
 * rest of the renderer runs unchanged on web.
 *
 * Cost model (see src/backend/cloud/README.md): every note write is a billed
 * write, so writes are buffered.
 *
 * - `write` / `writeData` coalesce per path/key and flush after `flushDelayMs`
 *   of idle (default 2.5 s), or at the latest `maxWaitMs` (default 15 s) after
 *   the first buffered change, so steady typing still saves.
 * - `appendData` lines are batched per key into one append per flush.
 * - Reads see buffered content (read-your-writes). Note bodies are cached for
 *   the session, so the app's tab switches and warm index re-reads are free
 *   after the first read; remote `change` events invalidate the cache.
 * - Pending writes are flushed before `rename` / `delete` / `create` touch the
 *   same paths, and everything is flushed on `visibilitychange` (hidden),
 *   `pagehide` and `beforeunload`.
 * - A failed write is retried once; then `onSaveError(path, error)` is called.
 *   A `PayloadTooLargeError` is dropped (retrying cannot help, and its message
 *   names the path/key); other errors are re-queued so the change is not lost
 *   and `hasPendingWrites()` stays true.
 *
 * Startup reads: `open` lists the tree (one read per note + folder) and starts
 * `repo.watch`, whose first snapshot bills the same again. CloudRepository's
 * `watch` does not replay current state, so it cannot replace `listTree`; the
 * watch is kept because it is the only way to see edits from other tabs and
 * devices. Bodies are then read lazily and cached (the app's warm index reads
 * each note once). `exportWorkspace` would fetch bodies in the same pass but
 * also downloads every `.vault/` key, including the append-only review log the
 * app never reads, so it is not used. Pass `liveSync: false` to skip the watch.
 */

import type { CloudRepository, CloudWatchEvent, Unsubscribe, WorkspaceId } from '../cloud/CloudRepository';
import { NotFoundError, PayloadTooLargeError } from '../cloud/errors';
import type { VaultBackend } from '../types';

export const DEFAULT_FLUSH_DELAY_MS = 2500;
export const DEFAULT_MAX_WAIT_MS = 15_000;
/** How long an expected watch echo of our own write stays suppressible. */
const ECHO_TTL_MS = 10_000;
const NOT_ON_WEB = 'Not available on web';

export interface CloudVaultOptions {
  repo: CloudRepository;
  getWorkspaceId: () => WorkspaceId;
  /** Called after a buffered write failed twice. `path` is the note path or data key. */
  onSaveError?: (path: string, error: Error) => void;
  /** Idle time before buffered writes flush. */
  flushDelayMs?: number;
  /** Upper bound on how long a change can sit in the buffer while writes keep coming. */
  maxWaitMs?: number;
  /** Subscribe to `repo.watch` when the vault opens (default true). */
  liveSync?: boolean;
  /** Listen for page hide/unload to flush (default: when `window` exists). */
  installPageListeners?: boolean;
}

export type CloudVault = VaultBackend & {
  /** Flush every buffered write now. Resolves when the repository settled. */
  flushAll(): Promise<void>;
  /** True while any write is buffered or in flight. */
  hasPendingWrites(): boolean;
  /** Stop watching and remove page listeners. Does not flush; call flushAll first. */
  dispose(): void;
};

type Kind = 'note' | 'data' | 'append';

interface Job {
  kind: Kind;
  key: string;
  run: () => Promise<void>;
  /** Put the change back into the buffer (unless a newer one replaced it). */
  requeue: () => void;
}

export function cloudRootFor(ws: WorkspaceId): string {
  return `cloud:${ws}`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

function notAvailable(): Promise<never> {
  return Promise.reject(new Error(NOT_ON_WEB));
}

export function createCloudVault(options: CloudVaultOptions): CloudVault {
  const { repo, getWorkspaceId, onSaveError } = options;
  const flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const liveSync = options.liveSync ?? true;

  const pendingNotes = new Map<string, string>();
  const pendingData = new Map<string, string>();
  const pendingAppends = new Map<string, string[]>();
  /** Session cache of note bodies (and of local writes, so reads see them). */
  const noteCache = new Map<string, string>();
  const dataCache = new Map<string, string | null>();
  /** Paths/keys with a repository write in flight. */
  const inflight = new Map<string, number>();
  /** Own note writes whose `change` echo we expect: path → expiry timestamps. */
  const expectedEchoes = new Map<string, number[]>();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  /** Flushes run one after another so writes to a path land in order. */
  let chain: Promise<void> = Promise.resolve();
  let inflightCount = 0;

  const listeners = new Set<(event: VaultWatchEvent) => void>();
  let unwatch: Unsubscribe | null = null;
  let watchedRoot: string | null = null;

  const ws = () => getWorkspaceId();
  const root = () => cloudRootFor(ws());

  // ── Buffer ───────────────────────────────────────────────────────────────

  function hasBuffered(): boolean {
    return pendingNotes.size > 0 || pendingData.size > 0 || pendingAppends.size > 0;
  }

  function clearTimers(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (maxTimer) clearTimeout(maxTimer);
    idleTimer = null;
    maxTimer = null;
  }

  function schedule(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void flushAll(), flushDelayMs);
    maxTimer ??= setTimeout(() => void flushAll(), maxWaitMs);
  }

  function noteJob(path: string, body: string): Job {
    return {
      kind: 'note',
      key: path,
      run: async () => {
        expectEcho(path);
        await repo.writeNote(ws(), path, body);
      },
      requeue: () => {
        if (!pendingNotes.has(path)) pendingNotes.set(path, body);
      },
    };
  }

  function dataJob(key: string, text: string): Job {
    return {
      kind: 'data',
      key,
      run: () => repo.writeData(ws(), key, text),
      requeue: () => {
        if (!pendingData.has(key)) pendingData.set(key, text);
      },
    };
  }

  function appendJob(key: string, lines: string[]): Job {
    const joined = lines.join('');
    return {
      kind: 'append',
      key,
      run: async () => {
        await repo.appendData(ws(), key, joined);
        dataCache.delete(key);
      },
      requeue: () => {
        pendingAppends.set(key, [joined, ...(pendingAppends.get(key) ?? [])]);
      },
    };
  }

  /** Remove buffered changes matching `select` and turn them into jobs. */
  function take(select: (kind: Kind, key: string) => boolean): Job[] {
    const jobs: Job[] = [];
    for (const [path, body] of [...pendingNotes]) {
      if (!select('note', path)) continue;
      pendingNotes.delete(path);
      jobs.push(noteJob(path, body));
    }
    for (const [key, text] of [...pendingData]) {
      if (!select('data', key)) continue;
      pendingData.delete(key);
      jobs.push(dataJob(key, text));
    }
    for (const [key, lines] of [...pendingAppends]) {
      if (!select('append', key)) continue;
      pendingAppends.delete(key);
      jobs.push(appendJob(key, lines));
    }
    if (!hasBuffered()) clearTimers();
    return jobs;
  }

  function markInflight(key: string, delta: 1 | -1): void {
    const next = (inflight.get(key) ?? 0) + delta;
    if (next > 0) inflight.set(key, next);
    else inflight.delete(key);
    inflightCount += delta;
  }

  async function runJob(job: Job): Promise<void> {
    try {
      try {
        await job.run();
      } catch (first) {
        if (first instanceof PayloadTooLargeError) throw first;
        await job.run();
      }
    } catch (error) {
      const err = toError(error);
      // Retrying a too-large payload cannot help; anything else (network,
      // permissions after a token blip) goes back in the buffer so the change
      // is not lost. The next write or page hide retries it.
      if (!(err instanceof PayloadTooLargeError)) job.requeue();
      if (onSaveError) onSaveError(job.key, err);
      else console.warn(`[cloud] could not save "${job.key}"`, err);
    } finally {
      markInflight(job.key, -1);
    }
  }

  /** Flush the buffered changes picked by `select`, after earlier flushes. */
  function flush(select: (kind: Kind, key: string) => boolean): Promise<void> {
    const jobs = take(select);
    // In flight from the moment they leave the buffer, so hasPendingWrites()
    // and read-your-writes checks never see a gap.
    for (const job of jobs) markInflight(job.key, 1);
    const run = chain.then(() => Promise.all(jobs.map(runJob)).then(() => {}));
    chain = run.catch(() => {});
    return run;
  }

  function flushAll(): Promise<void> {
    return flush(() => true);
  }

  function flushNotesUnder(path: string): Promise<void> {
    return flush((kind, key) => kind === 'note' && isUnder(key, path));
  }

  // ── Watch ────────────────────────────────────────────────────────────────

  function expectEcho(path: string): void {
    const list = expectedEchoes.get(path) ?? [];
    list.push(Date.now() + ECHO_TTL_MS);
    expectedEchoes.set(path, list);
  }

  /** True (and consumes it) when a `change` for `path` is the echo of our own write. */
  function consumeEcho(path: string): boolean {
    const now = Date.now();
    const list = (expectedEchoes.get(path) ?? []).filter((expiry) => expiry > now);
    if (!list.length) {
      expectedEchoes.delete(path);
      return false;
    }
    list.shift();
    if (list.length) expectedEchoes.set(path, list);
    else expectedEchoes.delete(path);
    return true;
  }

  function isLocal(path: string): boolean {
    return pendingNotes.has(path) || inflight.has(path);
  }

  function handleRemote(event: CloudWatchEvent, eventRoot: string): void {
    const { type, path } = event;
    if (type === 'change') {
      if (consumeEcho(path)) return;
      // Buffered local edits win; the app re-reads and gets them back.
      if (!isLocal(path)) noteCache.delete(path);
    } else if (type === 'add') {
      // A new note we wrote echoes as `add`: consume the expectation, still emit.
      const own = consumeEcho(path);
      if (!own && !isLocal(path)) noteCache.delete(path);
    } else if (type === 'unlink') {
      if (!isLocal(path)) noteCache.delete(path);
    } else if (type === 'unlinkDir') {
      for (const key of [...noteCache.keys()]) if (isUnder(key, path) && !isLocal(key)) noteCache.delete(key);
    }
    const out: VaultWatchEvent = { type, path, root: eventRoot };
    for (const cb of [...listeners]) cb(out);
  }

  function startWatch(): void {
    const current = root();
    if (!liveSync || !repo.watch) return;
    if (unwatch && watchedRoot === current) return;
    unwatch?.();
    watchedRoot = current;
    unwatch = repo.watch(ws(), (event) => handleRemote(event, current));
  }

  function stopWatch(): void {
    unwatch?.();
    unwatch = null;
    watchedRoot = null;
  }

  // ── Page lifecycle ───────────────────────────────────────────────────────

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') void flushAll();
  };
  const onPageHide = () => void flushAll();
  const installPage = options.installPageListeners ?? typeof window !== 'undefined';
  if (installPage) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
  }

  // ── Vault API ────────────────────────────────────────────────────────────

  async function list(): Promise<VaultListResult> {
    const tree = await repo.listTree(ws());
    const files = tree.notes.map((note) => note.path);
    // Notes written locally but not flushed yet still belong in the tree.
    for (const path of pendingNotes.keys()) if (!files.includes(path)) files.push(path);
    files.sort((a, b) => a.localeCompare(b));
    return { files, pdfFiles: [], folders: tree.folders };
  }

  async function openVault(): Promise<VaultOpenResult> {
    const result = { root: root(), ...(await list()) };
    startWatch();
    return result;
  }

  const vault: CloudVault = {
    open: openVault,
    ensureDefault: openVault,
    restore: openVault,
    list: () => list(),

    async read(_root, name) {
      const buffered = pendingNotes.get(name);
      if (buffered !== undefined) return buffered;
      const cached = noteCache.get(name);
      if (cached !== undefined) return cached;
      const body = await repo.readNote(ws(), name);
      if (body === null) throw new NotFoundError(`No note at "${name}"`);
      // A write may have landed while we were reading; it wins.
      if (!pendingNotes.has(name) && !noteCache.has(name)) noteCache.set(name, body);
      return pendingNotes.get(name) ?? noteCache.get(name) ?? body;
    },

    async write(_root, name, content) {
      if (noteCache.get(name) === content && !pendingNotes.has(name) && !inflight.has(name)) {
        return true; // unchanged: skip a billed write
      }
      pendingNotes.set(name, content);
      noteCache.set(name, content);
      schedule();
      return true;
    },

    async create(_root, name) {
      const wanted = /\.md$/i.test(name) ? name : `${name}.md`;
      await flushNotesUnder(wanted);
      const path = await repo.createNote(ws(), name);
      noteCache.delete(path);
      return path;
    },

    async mkdir(_root, name) {
      return repo.mkdir(ws(), name);
    },

    async rename(_root, from, to) {
      await flushNotesUnder(from);
      const next = await repo.rename(ws(), from, to);
      for (const [key, body] of [...noteCache]) {
        if (!isUnder(key, from)) continue;
        noteCache.delete(key);
        noteCache.set(next + key.slice(from.length), body);
      }
      return next;
    },

    async delete(_root, name) {
      // Buffered edits to a note we are deleting are moot.
      take((kind, key) => kind === 'note' && isUnder(key, name));
      await chain;
      await repo.remove(ws(), name);
      for (const key of [...noteCache.keys()]) if (isUnder(key, name)) noteCache.delete(key);
      return true;
    },

    async readData(_root, name) {
      const buffered = pendingData.get(name);
      if (buffered !== undefined) return buffered;
      if (pendingAppends.has(name) || inflight.has(name)) {
        await flush((kind, key) => kind === 'append' && key === name);
        await chain;
      }
      if (dataCache.has(name)) return dataCache.get(name) ?? null;
      const text = await repo.readData(ws(), name);
      if (!pendingData.has(name) && !pendingAppends.has(name)) dataCache.set(name, text);
      return pendingData.get(name) ?? text;
    },

    async writeData(_root, name, content) {
      if (pendingAppends.has(name)) {
        // writeData replaces the key, so lines appended before it are moot.
        pendingAppends.delete(name);
      }
      pendingData.set(name, content);
      dataCache.set(name, content);
      schedule();
      return true;
    },

    async appendData(_root, name, content) {
      if (pendingData.has(name)) {
        // Keep ordering simple: replace-then-append becomes one replace.
        const next = (pendingData.get(name) ?? '') + content;
        pendingData.set(name, next);
        dataCache.set(name, next);
      } else {
        const lines = pendingAppends.get(name) ?? [];
        lines.push(content);
        pendingAppends.set(name, lines);
        dataCache.delete(name);
      }
      schedule();
      return true;
    },

    async deleteData(_root, name) {
      pendingData.delete(name);
      pendingAppends.delete(name);
      if (!hasBuffered()) clearTimers();
      await chain;
      await repo.deleteData(ws(), name);
      dataCache.set(name, null);
      return true;
    },

    async watchStart() {
      startWatch();
      return true;
    },
    async watchStop() {
      stopWatch();
      return true;
    },
    onWatch(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    offWatch(callback) {
      listeners.delete(callback);
    },

    // Desktop-only (capabilities are off on web, so the UI hides these).
    importObsidian: notAvailable,
    importNotion: notAvailable,
    openPath: notAvailable,
    revealInFolder: notAvailable,
    importFile: notAvailable,
    extractPdfText: notAvailable,
    // Omitted on purpose: readPdf, exportNotePdf, takePdfExport, pdfExportReady,
    // and (until image storage exists) saveImage / readImageDataUrl.

    flushAll,
    hasPendingWrites: () => hasBuffered() || inflightCount > 0,
    dispose() {
      clearTimers();
      stopWatch();
      listeners.clear();
      if (installPage) {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('beforeunload', onPageHide);
      }
    },
  };
  return vault;
}
