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
 * Write-ahead journal (when `journal` is set; see writeJournal.ts): the
 * network flush on page hide cannot finish while the browser closes the tab,
 * so every buffered `write`, `writeData` and `appendData` is also stored
 * synchronously in localStorage, and removed only after the repository
 * confirmed that exact version (a newer edit made during the flush lives in
 * its own entry and survives). `create` / `rename` / `delete` / `mkdir` /
 * `deleteData` are not journaled: they are not buffered, the UI awaits them,
 * and they drop or move the journal entries of the paths they touch.
 * `open` (and `restore` / `ensureDefault`) first replays the entries that a
 * closed or crashed tab left behind, before the tree is listed:
 * - note entries are re-buffered and flushed right away; reads return the
 *   journaled text. When the remote note changed after the journaled edit
 *   (`updatedAt` newer than the entry, e.g. edited on another device), the
 *   remote note is kept and the journaled text is saved as a sibling
 *   `<name> (unsaved copy <date>).md`; `onRecovered` reports it. An entry
 *   whose text already equals the remote body is just dropped.
 * - data entries replay last-writer-wins (the repository has no timestamps
 *   for data); append entries replay in order.
 * `hasUnjournaledWrites()` is true only while some pending change could not
 * be journaled (no localStorage, quota full, entry too large); the web shell
 * warns before unload only then.
 *
 * Startup reads: `open` lists the tree (one read per note + folder) and starts
 * `repo.watch`, whose first snapshot bills the same again. CloudRepository's
 * `watch` does not replay current state, so it cannot replace `listTree`; the
 * watch is kept because it is the only way to see edits from other tabs and
 * devices. Bodies are then read lazily and cached (the app's warm index reads
 * each note once). `exportWorkspace` would fetch bodies in the same pass but
 * also downloads every `.vault/` key, including the append-only review log the
 * app never reads, so it is not used. Pass `liveSync: false` to skip the watch.
 *
 * Images and PDFs (when `files` is set) live in R2 behind the proxy Worker,
 * at the same vault-relative paths the desktop uses on disk: pasted images in
 * `<note dir>/.attachments/`, imported PDFs in the chosen folder. Each tree
 * load (`open` / `list`) makes ONE extra `GET /v1/files` call (one R2 list
 * operation per 1000 stored files) to fill `pdfFiles`. Image previews are
 * fetched once per session and cached in memory as data URLs. Folder renames
 * and deletes also move/delete the files under the folder (best effort).
 */

import type { CloudRepository, CloudWatchEvent, Unsubscribe, WorkspaceId } from '../cloud/CloudRepository';
import { NotFoundError, PayloadTooLargeError } from '../cloud/errors';
import type { VaultBackend } from '../types';
import { FilesError, type CloudFiles } from './filesClient';
import { extractPdfPagesInBrowser, MAX_PDF_PAGES } from './pdfText';
import type { JournalEntry, SlotRef, WriteJournal } from './writeJournal';

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
  /**
   * Image/PDF storage. Without it, saveImage / readImageDataUrl / readPdf are
   * omitted and importFile / extractPdfText reject (the UI hides them).
   */
  files?: CloudFiles;
  /**
   * Synchronous localStorage journal of buffered writes, replayed on open.
   * Without it, buffered writes only live in memory (the previous behavior).
   */
  journal?: WriteJournal | null;
  /** Journaled edits that conflicted with newer remote notes were saved as copies. */
  onRecovered?: (copies: RecoveredCopy[]) => void;
  /** File picker for `importFile` (default: a hidden `<input type=file>`). */
  pickFile?: (accept: string) => Promise<File | null>;
  /** PDF text extraction (default: pdfjs-dist in the browser). */
  extractPdfPages?: (bytes: Uint8Array, maxPages: number) => Promise<{ pages: string[]; totalPages: number }>;
}

export interface RecoveredCopy {
  /** Note whose remote version was kept. */
  path: string;
  /** Sibling note holding the journaled (unsaved) text. */
  copyPath: string;
}

export type CloudVault = VaultBackend & {
  /** Flush every buffered write now. Resolves when the repository settled. */
  flushAll(): Promise<void>;
  /** True while any write is buffered or in flight. */
  hasPendingWrites(): boolean;
  /**
   * True while a buffered or in-flight change is NOT in the journal, so
   * closing the tab now would lose it. Equals `hasPendingWrites()` without a journal.
   */
  hasUnjournaledWrites(): boolean;
  /** Stop watching and remove page listeners. Does not flush; call flushAll first. */
  dispose(): void;
};

type Kind = 'note' | 'data' | 'append';

/** Journal slots backing one buffered change. */
interface Slots {
  refs: SlotRef[];
  /** Slot that note/data writes overwrite while the change is buffered. */
  primary: SlotRef | null;
  /** The latest content could not be journaled. */
  unjournaled: boolean;
}

interface Job {
  kind: Kind;
  key: string;
  run: () => Promise<void>;
  /** Put the change back into the buffer (unless a newer one replaced it). */
  requeue: () => void;
  slots: Slots | undefined;
  /** Not (fully) journaled: closing the tab while in flight loses it. */
  unsafe: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `Stats/Bayes.md` -> `Stats/Bayes (unsaved copy 2026-11-14 19-05).md`, unique per `taken`. */
export function unsavedCopyPath(path: string, ts: number, taken: (path: string) => boolean): string {
  const d = new Date(ts);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
  const stem = path.replace(/\.md$/i, '');
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (unsaved copy ${stamp}${n > 1 ? ` ${n}` : ''}).md`;
    if (!taken(candidate)) return candidate;
  }
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

// ── Files helpers (mirror electron/main.cjs saveImage / readImageDataUrl) ──

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_CACHE_MAX = 64;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

function extname(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

function isPdfPath(path: string): boolean {
  return extname(path) === '.pdf';
}

/** Binary documents tracked in `pdfFiles`: PDFs and slide decks. */
function isDocumentPath(path: string): boolean {
  return extname(path) === '.pdf' || extname(path) === '.pptx';
}

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** Largest deck the browser will read; storage has its own (smaller) upload limit. */
const MAX_DECK_BYTES = 300 * 1024 * 1024;

function isNotePath(path: string): boolean {
  return extname(path) === '.md';
}

/** Collapse `.` / `..` segments; null when the path escapes the vault root. */
export function normalizeVaultPath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}

function baseName(name: string): string {
  return String(name || '').split(/[\\/]/).pop() ?? '';
}

function sanitizeImageStem(name: string): string {
  const base = baseName(name);
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const cleaned = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'image';
}

function sanitizePdfStem(name: string): string {
  const stem = baseName(name).replace(/\.pdf$/i, '');
  // eslint-disable-next-line no-control-regex
  const cleaned = stem.replace(/[\u0000-\u001f\u007f]+/g, '').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'Document';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function isExists(error: unknown): boolean {
  return error instanceof FilesError && error.code === 'already_exists';
}

/** Hidden `<input type=file>`; resolves null when the picker is cancelled. */
function pickFileInBrowser(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function createCloudVault(options: CloudVaultOptions): CloudVault {
  const { repo, getWorkspaceId, onSaveError } = options;
  const journal = options.journal ?? null;
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
  /** In-flight jobs whose change is not journaled. */
  let unsafeInflight = 0;
  /** Journal slots per buffered change, keyed by `slotKey(kind, key)`. */
  const slotsByChange = new Map<string, Slots>();
  /** Set while `open` replays the journal; reads wait for it. */
  let replaying: Promise<void> | null = null;

  const listeners = new Set<(event: VaultWatchEvent) => void>();
  let unwatch: Unsubscribe | null = null;
  let watchedRoot: string | null = null;

  const ws = () => getWorkspaceId();
  const root = () => cloudRootFor(ws());

  const files = options.files;
  /** PDF paths from the last tree load, kept current by import/rename/delete. */
  let pdfPaths = new Set<string>();
  /** Session cache of image previews: vault path → data URL ('' = missing). */
  const imageCache = new Map<string, Promise<string>>();

  function logFileError(what: string, error: unknown): void {
    console.warn(`[cloud] ${what} failed`, error);
  }

  function forgetFilesUnder(path: string): void {
    for (const key of [...imageCache.keys()]) if (isUnder(key, path)) imageCache.delete(key);
  }

  function cacheImage(path: string, value: Promise<string>): void {
    imageCache.delete(path);
    imageCache.set(path, value);
    while (imageCache.size > IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value;
      if (oldest === undefined) break;
      imageCache.delete(oldest);
    }
  }

  async function listPdfs(): Promise<string[]> {
    if (!files) return [];
    try {
      return (await files.list()).map((f) => f.path).filter(isDocumentPath);
    } catch (error) {
      logFileError('listing PDFs', error);
      return [...pdfPaths];
    }
  }

  /** Best-effort file move alongside a folder rename; never throws. */
  async function moveFilesUnder(from: string, to: string): Promise<void> {
    if (!files) return;
    try {
      await files.move(from, to);
    } catch (error) {
      logFileError(`moving files under "${from}"`, error);
    }
    pdfPaths = new Set([...pdfPaths].map((p) => (isUnder(p, from) ? to + p.slice(from.length) : p)));
    forgetFilesUnder(from);
  }

  /** Best-effort file delete alongside a folder delete; never throws. */
  async function removeFilesUnder(path: string): Promise<void> {
    if (!files) return;
    try {
      await files.remove(path, { recursive: true });
    } catch (error) {
      logFileError(`deleting files under "${path}"`, error);
    }
    pdfPaths = new Set([...pdfPaths].filter((p) => !isUnder(p, path)));
    forgetFilesUnder(path);
  }

  function hasPdfsUnder(path: string): boolean {
    for (const p of pdfPaths) if (isUnder(p, path)) return true;
    return false;
  }

  // ── Journal ──────────────────────────────────────────────────────────────

  function slotKey(kind: Kind, key: string): string {
    return `${kind}\u0000${key}`;
  }

  function slotsFor(kind: Kind, key: string): Slots {
    const id = slotKey(kind, key);
    let slots = slotsByChange.get(id);
    if (!slots) {
      slots = { refs: [], primary: null, unjournaled: false };
      slotsByChange.set(id, slots);
    }
    return slots;
  }

  function detachSlots(kind: Kind, key: string): Slots | undefined {
    const id = slotKey(kind, key);
    const slots = slotsByChange.get(id);
    slotsByChange.delete(id);
    return slots;
  }

  function releaseSlots(slots: Slots | undefined): void {
    if (!journal || !slots) return;
    for (const ref of slots.refs) journal.remove(ref);
  }

  /** The buffered change was dropped: forget its journal entries. */
  function dropSlots(kind: Kind, key: string): void {
    releaseSlots(detachSlots(kind, key));
  }

  /** Journal the latest full content of a buffered note/data change (synchronous). */
  function journalReplace(kind: 'note' | 'data', key: string, content: string): void {
    if (!journal) return;
    const slots = slotsFor(kind, key);
    const entry = journal.put(slots.primary?.id ?? null, kind, key, content);
    if (!entry) {
      // Older entries stay: they are the best fallback until the save lands.
      slots.unjournaled = true;
      return;
    }
    const ref = { id: entry.id, seq: entry.seq };
    for (const old of slots.refs) if (old.id !== ref.id) journal.remove(old);
    slots.refs = [ref];
    slots.primary = ref;
    slots.unjournaled = false;
  }

  /** Journal one appended line (each append gets its own entry). */
  function journalAppend(key: string, line: string): void {
    if (!journal) return;
    const slots = slotsFor('append', key);
    const entry = journal.put(null, 'append', key, line);
    if (entry) slots.refs.push({ id: entry.id, seq: entry.seq });
    else slots.unjournaled = true;
  }

  /** A failed job's change went back into the buffer: re-attach its journal entries. */
  function requeueSlots(kind: Kind, key: string, slots: Slots | undefined, restored: boolean): void {
    if (!journal || !slots) return;
    if (restored) {
      slotsByChange.set(slotKey(kind, key), slots);
      return;
    }
    const current = slotsFor(kind, key);
    if (kind === 'append' || current.unjournaled) {
      // Appends: the old lines are pending again. Unjournaled newer edit: keep the older text as a fallback.
      current.refs = [...slots.refs, ...current.refs];
      if (kind === 'append') current.unjournaled ||= slots.unjournaled;
    } else {
      releaseSlots(slots); // superseded by a newer journaled edit
    }
  }

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

  function isUnsafe(slots: Slots | undefined): boolean {
    return !journal || !slots || slots.unjournaled;
  }

  function noteJob(path: string, body: string, slots: Slots | undefined): Job {
    return {
      kind: 'note',
      key: path,
      slots,
      unsafe: isUnsafe(slots),
      run: async () => {
        expectEcho(path);
        await repo.writeNote(ws(), path, body);
      },
      requeue: () => {
        const restored = !pendingNotes.has(path);
        if (restored) pendingNotes.set(path, body);
        requeueSlots('note', path, slots, restored);
      },
    };
  }

  function dataJob(key: string, text: string, slots: Slots | undefined): Job {
    return {
      kind: 'data',
      key,
      slots,
      unsafe: isUnsafe(slots),
      run: () => repo.writeData(ws(), key, text),
      requeue: () => {
        const restored = !pendingData.has(key);
        if (restored) pendingData.set(key, text);
        requeueSlots('data', key, slots, restored);
      },
    };
  }

  function appendJob(key: string, lines: string[], slots: Slots | undefined): Job {
    const joined = lines.join('');
    return {
      kind: 'append',
      key,
      slots,
      unsafe: isUnsafe(slots),
      run: async () => {
        await repo.appendData(ws(), key, joined);
        dataCache.delete(key);
      },
      requeue: () => {
        const restored = !pendingAppends.has(key);
        pendingAppends.set(key, [joined, ...(pendingAppends.get(key) ?? [])]);
        requeueSlots('append', key, slots, restored);
      },
    };
  }

  /** Remove buffered changes matching `select` and turn them into jobs. */
  function take(select: (kind: Kind, key: string) => boolean): Job[] {
    const jobs: Job[] = [];
    for (const [path, body] of [...pendingNotes]) {
      if (!select('note', path)) continue;
      pendingNotes.delete(path);
      jobs.push(noteJob(path, body, detachSlots('note', path)));
    }
    for (const [key, text] of [...pendingData]) {
      if (!select('data', key)) continue;
      pendingData.delete(key);
      jobs.push(dataJob(key, text, detachSlots('data', key)));
    }
    for (const [key, lines] of [...pendingAppends]) {
      if (!select('append', key)) continue;
      pendingAppends.delete(key);
      jobs.push(appendJob(key, lines, detachSlots('append', key)));
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
      // Saved: only now drop the journal entries for exactly this version.
      releaseSlots(job.slots);
    } catch (error) {
      const err = toError(error);
      // Retrying a too-large payload cannot help; anything else (network,
      // permissions after a token blip) goes back in the buffer so the change
      // is not lost. The next write or page hide retries it.
      if (err instanceof PayloadTooLargeError) releaseSlots(job.slots);
      else job.requeue();
      if (onSaveError) onSaveError(job.key, err);
      else console.warn(`[cloud] could not save "${job.key}"`, err);
    } finally {
      markInflight(job.key, -1);
      if (job.unsafe) unsafeInflight -= 1;
    }
  }

  /** Flush the buffered changes picked by `select`, after earlier flushes. */
  function flush(select: (kind: Kind, key: string) => boolean): Promise<void> {
    const jobs = take(select);
    // In flight from the moment they leave the buffer, so hasPendingWrites()
    // and read-your-writes checks never see a gap.
    for (const job of jobs) {
      markInflight(job.key, 1);
      if (job.unsafe) unsafeInflight += 1;
    }
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

  // The network flush is best effort (the browser may kill it during unload);
  // the journal already holds every buffered change.
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') void flushAll();
    else journal?.heartbeat();
  };
  const onBeforeUnload = () => void flushAll();
  const onPageHide = (event: Event) => {
    void flushAll();
    // Closing for good: let the next tab replay what this one leaves behind.
    // A page kept in the back/forward cache may come back, so it keeps its claim.
    if (!(event as PageTransitionEvent).persisted) journal?.markClosed();
  };
  const onPageShow = () => journal?.heartbeat();
  const installPage = options.installPageListeners ?? typeof window !== 'undefined';
  if (installPage) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('beforeunload', onBeforeUnload);
  }
  journal?.heartbeat();
  const heartbeatTimer = journal ? setInterval(() => journal.heartbeat(), 20_000) : null;

  // ── Journal replay ───────────────────────────────────────────────────────

  function seedNote(path: string, entry: JournalEntry): void {
    pendingNotes.set(path, entry.content);
    noteCache.set(path, entry.content);
    const slots = slotsFor('note', path);
    let ref: SlotRef = { id: entry.id, seq: entry.seq };
    if (entry.key !== path && journal) {
      // Re-key the entry so a crash before the flush replays the copy, not the original.
      const moved = journal.put(entry.id, 'note', path, entry.content);
      if (moved) ref = { id: moved.id, seq: moved.seq };
      else slots.unjournaled = true;
    }
    slots.refs = [ref];
    slots.primary = ref;
  }

  function seedData(entry: JournalEntry): void {
    pendingData.set(entry.key, entry.content);
    dataCache.set(entry.key, entry.content);
    const ref = { id: entry.id, seq: entry.seq };
    const slots = slotsFor('data', entry.key);
    slots.refs = [ref];
    slots.primary = ref;
  }

  function seedAppend(entry: JournalEntry): void {
    const lines = pendingAppends.get(entry.key) ?? [];
    lines.push(entry.content);
    pendingAppends.set(entry.key, lines);
    dataCache.delete(entry.key);
    slotsFor('append', entry.key).refs.push({ id: entry.id, seq: entry.seq });
  }

  /** Re-buffer what closed or crashed tabs left in the journal, then flush it. */
  async function replayJournal(): Promise<void> {
    if (!journal) return;
    const j = journal;
    let claimed: JournalEntry[];
    try {
      claimed = await j.withLock(() => j.claimOrphans());
    } catch (error) {
      console.warn('[cloud] could not read the write journal', error);
      return;
    }
    if (!claimed.length) return;

    // Oldest first: for notes/data the last entry per key wins, appends keep their order.
    const latest = new Map<string, JournalEntry>();
    const appends: JournalEntry[] = [];
    for (const entry of claimed) {
      if (entry.kind === 'append') {
        appends.push(entry);
        continue;
      }
      const id = slotKey(entry.kind, entry.key);
      const prev = latest.get(id);
      if (prev) j.remove(prev);
      latest.set(id, entry);
    }

    const metas = new Map<string, number>();
    if ([...latest.values()].some((e) => e.kind === 'note')) {
      try {
        for (const note of (await repo.listTree(ws())).notes) metas.set(note.path, Date.parse(note.updatedAt));
      } catch (error) {
        // Offline: the entries stay in the journal for a later session.
        console.warn('[cloud] could not replay unsaved edits', error);
        return;
      }
    }
    const taken = (path: string) => metas.has(path) || pendingNotes.has(path);
    const copies: RecoveredCopy[] = [];
    let seeded = false;

    for (const entry of latest.values()) {
      if (entry.kind === 'data') {
        if (pendingData.has(entry.key) || inflight.has(entry.key)) j.remove(entry);
        else {
          seedData(entry);
          seeded = true;
        }
        continue;
      }
      const path = entry.key;
      if (pendingNotes.has(path) || inflight.has(path)) {
        j.remove(entry); // this session already saved something newer
        continue;
      }
      const remoteAt = metas.get(path);
      if (remoteAt !== undefined && remoteAt > entry.ts) {
        let remote: string | null;
        try {
          remote = await repo.readNote(ws(), path);
        } catch (error) {
          console.warn(`[cloud] could not check "${path}" before replaying it`, error);
          continue; // stays in the journal
        }
        if (remote === entry.content) {
          j.remove(entry); // it was saved before the tab closed
          continue;
        }
        if (remote !== null) {
          // Edited elsewhere after this edit: keep the remote note, save ours beside it.
          const copyPath = unsavedCopyPath(path, entry.ts, taken);
          noteCache.set(path, remote);
          seedNote(copyPath, entry);
          copies.push({ path, copyPath });
          seeded = true;
          continue;
        }
      }
      seedNote(path, entry);
      seeded = true;
    }

    for (const entry of appends) {
      seedAppend(entry);
      seeded = true;
    }

    if (seeded) void flushAll();
    if (copies.length) {
      if (options.onRecovered) options.onRecovered(copies);
      else console.warn('[cloud] saved unsaved edits as copies', copies);
    }
  }

  // ── Vault API ────────────────────────────────────────────────────────────

  async function list(): Promise<VaultListResult> {
    const [tree, pdfs] = await Promise.all([repo.listTree(ws()), listPdfs()]);
    const notes = tree.notes.map((note) => note.path);
    // Notes written locally but not flushed yet still belong in the tree.
    for (const path of pendingNotes.keys()) if (!notes.includes(path)) notes.push(path);
    notes.sort((a, b) => a.localeCompare(b));
    pdfPaths = new Set(pdfs);
    const pdfFiles = [...pdfPaths].sort((a, b) => a.localeCompare(b));
    // A PDF's folders show in the tree even when they hold no notes.
    const folders = new Set(tree.folders);
    const before = folders.size;
    for (const pdf of pdfFiles) {
      for (let dir = dirname(pdf); dir; dir = dirname(dir)) folders.add(dir);
    }
    const folderList = folders.size === before ? tree.folders : [...folders].sort((a, b) => a.localeCompare(b));
    return { files: notes, pdfFiles, folders: folderList };
  }

  async function openVault(): Promise<VaultOpenResult> {
    if (journal) {
      replaying ??= replayJournal().finally(() => {
        replaying = null;
      });
      await replaying;
    }
    const result = { root: root(), ...(await list()) };
    startWatch();
    return result;
  }

  // ── Files (images + PDFs) ────────────────────────────────────────────────

  async function saveImage(
    _root: string,
    notePath: string,
    bytes: Uint8Array,
    mime: string,
    suggestedName = '',
  ): Promise<string> {
    if (!files) return notAvailable();
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid image data');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 8 MB.');
    const extFromName = extname(String(suggestedName || ''));
    const ext = IMAGE_EXT_BY_MIME[mime] || (IMAGE_MIME[extFromName] ? extFromName : null);
    if (!ext) throw new Error('Unsupported image type.');
    const contentType = IMAGE_MIME[ext];
    const noteDir = dirname(String(notePath || ''));
    const attachments = noteDir ? `${noteDir}/.attachments` : '.attachments';
    const stem = sanitizeImageStem(suggestedName);
    // One list call finds a free name; ifAbsent guards against races.
    const taken = new Set<string>();
    try {
      for (const f of await files.list(`${attachments}/`)) taken.add(f.path);
    } catch (error) {
      logFileError('listing attachments', error);
    }
    for (let n = 1; n < 10_000; n += 1) {
      const name = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
      const path = `${attachments}/${name}`;
      if (taken.has(path)) continue;
      try {
        await files.put(path, bytes, contentType, { ifAbsent: true });
      } catch (error) {
        if (isExists(error)) continue;
        throw error;
      }
      cacheImage(path, Promise.resolve(toDataUrl(bytes, contentType)));
      return `.attachments/${name}`;
    }
    throw new Error('Could not find a free name for this image.');
  }

  async function readImageDataUrl(_root: string, notePath: string, src: string): Promise<string> {
    if (!files || typeof src !== 'string' || /^(https?:|data:)/i.test(src)) return '';
    const noteDir = dirname(String(notePath || ''));
    let decoded = src.trim().replace(/^<|>$/g, '');
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep the raw path when it is not percent-encoded.
    }
    const path = normalizeVaultPath(noteDir ? `${noteDir}/${decoded}` : decoded);
    if (!path) return '';
    const cached = imageCache.get(path);
    if (cached) return cached;
    const mime = IMAGE_MIME[extname(path)] || 'application/octet-stream';
    const loading: Promise<string> = files.getBytes(path).then(
      (bytes) => (bytes.length > MAX_IMAGE_BYTES ? '' : toDataUrl(bytes, mime)),
      (error: unknown) => {
        // Stale references are normal: cache the miss. Retry other failures later.
        if (!(error instanceof FilesError && error.code === 'not_found')) {
          if (imageCache.get(path) === loading) imageCache.delete(path);
          logFileError(`loading image "${path}"`, error);
        }
        return '';
      },
    );
    cacheImage(path, loading);
    return loading;
  }

  async function readPdf(_root: string, name: string): Promise<Uint8Array> {
    if (!files) return notAvailable();
    if (typeof name !== 'string' || !isPdfPath(name)) throw new Error('Not a PDF file');
    return files.getBytes(name);
  }

  async function extractPdfText(_root: string, name: string): Promise<{ pages: string[]; totalPages: number }> {
    if (!files) return notAvailable();
    if (!isPdfPath(name)) throw new Error('Only .pdf files are allowed');
    const bytes = await files.getBytes(name);
    return (options.extractPdfPages ?? extractPdfPagesInBrowser)(bytes, MAX_PDF_PAGES);
  }

  /**
   * Upload a PDF picked in the browser into `folder`; never overwrites
   * ("Notes 2.pdf"). A slide deck is returned as `{ name, bytes }` for the
   * renderer to import as a quiz source instead.
   */
  async function importFile(_root: string, folder: string): Promise<string | PickedFile | null> {
    if (!files) return notAvailable();
    const file = await (options.pickFile ?? pickFileInBrowser)(`.pdf,application/pdf,.pptx,${PPTX_MIME},.ppt`);
    if (!file) return null;
    if (/\.pptx?$/i.test(file.name)) {
      if (file.size > MAX_DECK_BYTES) throw new Error('Slide deck is larger than 300 MB.');
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      throw new Error('Only PDF files can be imported on the web.');
    }
    const dir = folder ? normalizeVaultPath(folder) : '';
    if (dir === null) throw new Error('Invalid folder');
    const stem = sanitizePdfStem(file.name);
    for (let n = 1; n < 10_000; n += 1) {
      const name = n === 1 ? `${stem}.pdf` : `${stem} ${n}.pdf`;
      const path = dir ? `${dir}/${name}` : name;
      if (pdfPaths.has(path)) continue;
      try {
        await files.put(path, file, 'application/pdf', { ifAbsent: true });
      } catch (error) {
        if (isExists(error)) continue;
        throw error;
      }
      pdfPaths.add(path);
      return path;
    }
    throw new Error('Could not find a free name for this PDF.');
  }

  async function readDocument(_root: string, name: string): Promise<Uint8Array> {
    if (!files) return notAvailable();
    if (typeof name !== 'string' || !isDocumentPath(name)) throw new Error('Not a PDF or slide deck');
    return files.getBytes(name);
  }

  /** Upload a new .pptx or PDF; rejects if the path is taken. Returns its vault path. */
  async function saveDocument(_root: string, name: string, bytes: Uint8Array): Promise<string> {
    if (!files) return notAvailable();
    const path = normalizeVaultPath(name);
    if (!path || !isDocumentPath(path)) throw new Error('Only .pptx decks and PDFs can be saved');
    await files.put(path, bytes, extname(path) === '.pdf' ? 'application/pdf' : PPTX_MIME, { ifAbsent: true });
    pdfPaths.add(path);
    return path;
  }

  const vault: CloudVault = {
    open: openVault,
    ensureDefault: openVault,
    restore: openVault,
    list: () => list(),

    async read(_root, name) {
      if (replaying) await replaying;
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
      journalReplace('note', name, content);
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
      if (isDocumentPath(from)) {
        if (!files) return notAvailable();
        const ext = extname(from);
        const raw = String(to || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const target = normalizeVaultPath(extname(raw) === ext ? raw : `${raw}${ext}`);
        if (!target || extname(target) !== ext) throw new Error('Invalid destination path');
        if (target === from) return from;
        if (pdfPaths.has(target)) throw new Error(`"${target}" already exists`);
        await files.move(from, target);
        pdfPaths.delete(from);
        pdfPaths.add(target);
        return target;
      }
      const isFolder = !isNotePath(from);
      await flushNotesUnder(from);
      let next: string;
      try {
        next = await repo.rename(ws(), from, to);
      } catch (error) {
        // A folder that only holds PDFs has no notes to rename.
        const target = normalizeVaultPath(String(to || ''));
        if (!(isFolder && error instanceof NotFoundError && target && hasPdfsUnder(from))) throw error;
        next = target;
      }
      for (const [key, body] of [...noteCache]) {
        if (!isUnder(key, from)) continue;
        noteCache.delete(key);
        noteCache.set(next + key.slice(from.length), body);
      }
      // Edits buffered under the old path (made during the rename, or re-queued
      // after a failed flush) follow it instead of recreating the old note.
      for (const [key, body] of [...pendingNotes]) {
        if (!isUnder(key, from)) continue;
        const moved = next + key.slice(from.length);
        pendingNotes.delete(key);
        dropSlots('note', key);
        pendingNotes.set(moved, body);
        journalReplace('note', moved, body);
      }
      // Attachments and PDFs under a renamed folder follow it.
      if (isFolder) await moveFilesUnder(from, next);
      return next;
    },

    async delete(_root, name) {
      if (isDocumentPath(name)) {
        if (!files) return notAvailable();
        await files.remove(name);
        pdfPaths.delete(name);
        return true;
      }
      const isFolder = !isNotePath(name);
      // Buffered edits to a note we are deleting are moot.
      for (const job of take((kind, key) => kind === 'note' && isUnder(key, name))) releaseSlots(job.slots);
      await chain;
      try {
        await repo.remove(ws(), name);
      } catch (error) {
        // A folder that only holds PDFs has no notes to remove.
        if (!(isFolder && error instanceof NotFoundError && hasPdfsUnder(name))) throw error;
      }
      for (const key of [...noteCache.keys()]) if (isUnder(key, name)) noteCache.delete(key);
      if (isFolder) await removeFilesUnder(name);
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
        dropSlots('append', name);
      }
      pendingData.set(name, content);
      dataCache.set(name, content);
      journalReplace('data', name, content);
      schedule();
      return true;
    },

    async appendData(_root, name, content) {
      if (pendingData.has(name)) {
        // Keep ordering simple: replace-then-append becomes one replace.
        const next = (pendingData.get(name) ?? '') + content;
        pendingData.set(name, next);
        dataCache.set(name, next);
        journalReplace('data', name, next);
      } else {
        const lines = pendingAppends.get(name) ?? [];
        lines.push(content);
        pendingAppends.set(name, lines);
        dataCache.delete(name);
        journalAppend(name, content);
      }
      schedule();
      return true;
    },

    async deleteData(_root, name) {
      pendingData.delete(name);
      pendingAppends.delete(name);
      dropSlots('data', name);
      dropSlots('append', name);
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
    // Omitted on purpose: exportNotePdf, takePdfExport, pdfExportReady.

    // Need file storage. Without it readPdf is absent, which turns
    // `capabilities.fileImport` off on web.
    importFile: files ? importFile : notAvailable,
    extractPdfText: files ? extractPdfText : notAvailable,
    ...(files ? { saveImage, readImageDataUrl, readPdf, readDocument, saveDocument } : {}),

    flushAll,
    hasPendingWrites: () => hasBuffered() || inflightCount > 0,
    hasUnjournaledWrites() {
      if (!journal) return hasBuffered() || inflightCount > 0;
      if (unsafeInflight > 0) return true;
      for (const slots of slotsByChange.values()) if (slots.unjournaled) return true;
      return false;
    },
    dispose() {
      clearTimers();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      // Whatever is still journaled now belongs to the next session.
      journal?.markClosed();
      stopWatch();
      listeners.clear();
      if (installPage) {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('beforeunload', onBeforeUnload);
      }
    },
  };
  return vault;
}
