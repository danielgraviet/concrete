/**
 * Firestore implementation of CloudRepository.
 *
 * Layout (see ../README.md):
 *   users/{uid}/notes/{noteId}        { path, body, updatedAt, size }
 *   users/{uid}/folders/{encPath}     { path }
 *   users/{uid}/data/{encKey}         { key, text, updatedAt, parts }      ← head (latest chunk)
 *   users/{uid}/data/{encKey}~{n}     { key, text, updatedAt, part: n }    ← sealed append chunks
 *   shares/{shareId}                  { ownerUid, kind, title, payload (JSON string), createdAt }
 *
 * Every read is billed on the Spark plan (50k/day), so lookups go by
 * document id where possible and listings are one query per collection.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import {
  MAX_PAYLOAD_BYTES,
  type CloudRepository,
  type CloudTree,
  type CloudWatchCallback,
  type CreateShareInput,
  type JsonValue,
  type NoteMeta,
  type ShareKind,
  type ShareMeta,
  type ShareRecord,
  type Unsubscribe,
  type WorkspaceExport,
  type WorkspaceId,
} from '../CloudRepository';
import {
  CloudError,
  ConflictError,
  InvalidPathError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionError,
} from '../errors';
import {
  ancestorFolders,
  byteLength,
  encodeDataKey,
  ensureMdExtension,
  isUnder,
  normalizePath,
  noteTitle,
  reprefix,
} from '../paths';

/** Firestore allows 500 writes per batch; stay well under. */
const BATCH_LIMIT = 450;

interface NoteDoc {
  path: string;
  body: string;
  updatedAt: string;
  size: number;
}

interface FolderDoc {
  path: string;
}

interface DataDoc {
  key: string;
  text: string;
  updatedAt: string;
  /** Head doc: number of sealed chunks before it. */
  parts?: number;
  /** Sealed chunk: its index. */
  part?: number;
}

interface ShareDoc {
  ownerUid: string;
  kind: ShareKind;
  title: string;
  payload: string;
  createdAt: string;
}

export interface FirebaseCloudRepositoryOptions {
  maxPayloadBytes?: number;
}

type BatchOp = (batch: WriteBatch) => void;

export class FirebaseCloudRepository implements CloudRepository {
  private readonly maxBytes: number;
  /** path → noteId per workspace; saves a query per autosave. Always verified before use. */
  private readonly idCache = new Map<WorkspaceId, Map<string, string>>();

  constructor(
    private readonly db: Firestore,
    options: FirebaseCloudRepositoryOptions = {},
  ) {
    this.maxBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  }

  // ── Notes & folders ──────────────────────────────────────────────────────

  listTree(ws: WorkspaceId): Promise<CloudTree> {
    return guard(async () => {
      const [noteSnap, folderSnap] = await Promise.all([getDocs(this.notes(ws)), getDocs(this.folders(ws))]);
      const cache = this.cache(ws);
      cache.clear();
      const notes: NoteMeta[] = noteSnap.docs.map((d) => {
        const data = d.data() as NoteDoc;
        cache.set(data.path, d.id);
        return { id: d.id, path: data.path, updatedAt: data.updatedAt, size: data.size ?? byteLength(data.body ?? '') };
      });
      notes.sort((a, b) => a.path.localeCompare(b.path));
      const folders = new Set(folderSnap.docs.map((d) => (d.data() as FolderDoc).path));
      for (const n of notes) for (const f of ancestorFolders(n.path)) folders.add(f);
      return { notes, folders: [...folders].sort() };
    });
  }

  readNote(ws: WorkspaceId, path: string): Promise<string | null> {
    return guard(async () => {
      const p = normalizePath(path);
      const cachedId = this.cache(ws).get(p);
      if (cachedId) {
        const snap = await getDoc(this.noteRef(ws, cachedId));
        const data = snap.data() as NoteDoc | undefined;
        if (data?.path === p) return data.body;
        this.cache(ws).delete(p);
      }
      const found = await this.findNote(ws, p);
      return found ? found.data.body : null;
    });
  }

  writeNote(ws: WorkspaceId, path: string, body: string): Promise<void> {
    return guard(async () => {
      const p = normalizePath(path);
      this.checkSize(p, body);
      const fields = { body, size: byteLength(body), updatedAt: now() };

      // Fast path: known id → verify path and update atomically (1 read, 1 write).
      const cachedId = this.cache(ws).get(p);
      if (cachedId) {
        const ref = this.noteRef(ws, cachedId);
        const hit = await runTransaction(this.db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists() || (snap.data() as NoteDoc).path !== p) return false;
          tx.update(ref, fields);
          return true;
        });
        if (hit) return;
        this.cache(ws).delete(p);
      }

      const found = await this.findNote(ws, p);
      if (found) {
        await updateDoc(found.ref, fields);
        return;
      }
      await this.insertNote(ws, p, body);
    });
  }

  createNote(ws: WorkspaceId, name: string, body?: string): Promise<string> {
    return guard(async () => {
      const p = ensureMdExtension(normalizePath(name));
      const text = body ?? `# ${noteTitle(p)}\n\n`;
      this.checkSize(p, text);
      if (await this.findNote(ws, p)) throw new ConflictError(`A note already exists at "${p}"`);
      await this.insertNote(ws, p, text);
      return p;
    });
  }

  mkdir(ws: WorkspaceId, path: string): Promise<string> {
    return guard(async () => {
      const p = normalizePath(path);
      await this.commit(this.folderOps(ws, [...ancestorFolders(p), p]));
      return p;
    });
  }

  rename(ws: WorkspaceId, from: string, to: string): Promise<string> {
    return guard(async () => {
      const src = normalizePath(from);
      const note = await this.findNote(ws, src);
      if (note) {
        const dest = ensureMdExtension(normalizePath(to));
        if (dest === src) return src;
        await this.assertFree(ws, dest);
        const stamp = now();
        await this.commit([
          ...this.folderOps(ws, ancestorFolders(dest)),
          (b) => b.update(note.ref, { path: dest, updatedAt: stamp }),
        ]);
        this.cache(ws).delete(src);
        this.cache(ws).set(dest, note.ref.id);
        return dest;
      }

      const dest = normalizePath(to);
      const [notesUnder, foldersUnder, srcFolder] = await Promise.all([
        getDocs(this.underPrefix(this.notes(ws), src)),
        getDocs(this.underPrefix(this.folders(ws), src)),
        getDoc(this.folderRef(ws, src)),
      ]);
      if (notesUnder.empty && foldersUnder.empty && !srcFolder.exists()) {
        throw new NotFoundError(`Nothing exists at "${src}"`);
      }
      if (dest === src) return src;
      if (isUnder(dest, src)) throw new InvalidPathError(`Cannot move "${src}" into itself`);
      await this.assertFree(ws, dest);

      const stamp = now();
      const cache = this.cache(ws);
      const ops: BatchOp[] = [...this.folderOps(ws, [...ancestorFolders(dest), dest])];
      for (const d of notesUnder.docs) {
        const oldPath = (d.data() as NoteDoc).path;
        const next = reprefix(oldPath, src, dest);
        ops.push((b) => b.update(d.ref, { path: next, updatedAt: stamp }));
        cache.delete(oldPath);
        cache.set(next, d.id);
      }
      const folderDocs = [...foldersUnder.docs, ...(srcFolder.exists() ? [srcFolder] : [])];
      for (const d of folderDocs) {
        const next = reprefix((d.data() as FolderDoc).path, src, dest);
        ops.push((b) => b.delete(d.ref));
        ops.push((b) => b.set(this.folderRef(ws, next), { path: next } satisfies FolderDoc));
      }
      await this.commit(ops);
      return dest;
    });
  }

  remove(ws: WorkspaceId, path: string): Promise<void> {
    return guard(async () => {
      const p = normalizePath(path);
      const note = await this.findNote(ws, p);
      if (note) {
        await deleteDoc(note.ref);
        this.cache(ws).delete(p);
        return;
      }
      const [notesUnder, foldersUnder, folder] = await Promise.all([
        getDocs(this.underPrefix(this.notes(ws), p)),
        getDocs(this.underPrefix(this.folders(ws), p)),
        getDoc(this.folderRef(ws, p)),
      ]);
      if (notesUnder.empty && foldersUnder.empty && !folder.exists()) {
        throw new NotFoundError(`Nothing exists at "${p}"`);
      }
      const cache = this.cache(ws);
      const ops: BatchOp[] = [];
      for (const d of notesUnder.docs) {
        cache.delete((d.data() as NoteDoc).path);
        ops.push((b) => b.delete(d.ref));
      }
      for (const d of foldersUnder.docs) ops.push((b) => b.delete(d.ref));
      if (folder.exists()) ops.push((b) => b.delete(folder.ref));
      await this.commit(ops);
    });
  }

  // ── App data ─────────────────────────────────────────────────────────────

  readData(ws: WorkspaceId, key: string): Promise<string | null> {
    return guard(async () => {
      const head = await getDoc(this.dataRef(ws, key));
      if (!head.exists()) return null;
      const data = head.data() as DataDoc;
      const parts = data.parts ?? 0;
      if (!parts) return data.text;
      const sealed = await Promise.all(
        Array.from({ length: parts }, (_, i) => getDoc(this.dataRef(ws, key, i))),
      );
      return sealed.map((s) => (s.data() as DataDoc | undefined)?.text ?? '').join('') + data.text;
    });
  }

  writeData(ws: WorkspaceId, key: string, text: string): Promise<void> {
    return guard(async () => {
      this.checkSize(key, text);
      const headRef = this.dataRef(ws, key);
      await runTransaction(this.db, async (tx) => {
        const head = await tx.get(headRef);
        const parts = head.exists() ? ((head.data() as DataDoc).parts ?? 0) : 0;
        for (let i = 0; i < parts; i += 1) tx.delete(this.dataRef(ws, key, i));
        tx.set(headRef, { key, text, updatedAt: now(), parts: 0 } satisfies DataDoc);
      });
    });
  }

  appendData(ws: WorkspaceId, key: string, line: string): Promise<void> {
    return guard(async () => {
      const lineBytes = this.checkSize(key, line);
      const headRef = this.dataRef(ws, key);
      await runTransaction(this.db, async (tx) => {
        const head = await tx.get(headRef);
        const stamp = now();
        if (!head.exists()) {
          tx.set(headRef, { key, text: line, updatedAt: stamp, parts: 0 } satisfies DataDoc);
          return;
        }
        const data = head.data() as DataDoc;
        if (byteLength(data.text) + lineBytes <= this.maxBytes) {
          tx.update(headRef, { text: data.text + line, updatedAt: stamp });
          return;
        }
        // Head is full: seal it as chunk N and start a fresh head.
        const parts = data.parts ?? 0;
        tx.set(this.dataRef(ws, key, parts), { key, text: data.text, updatedAt: stamp, part: parts } satisfies DataDoc);
        tx.set(headRef, { key, text: line, updatedAt: stamp, parts: parts + 1 } satisfies DataDoc);
      });
    });
  }

  deleteData(ws: WorkspaceId, key: string): Promise<void> {
    return guard(async () => {
      const headRef = this.dataRef(ws, key);
      await runTransaction(this.db, async (tx) => {
        const head = await tx.get(headRef);
        if (!head.exists()) return;
        const parts = (head.data() as DataDoc).parts ?? 0;
        for (let i = 0; i < parts; i += 1) tx.delete(this.dataRef(ws, key, i));
        tx.delete(headRef);
      });
    });
  }

  // ── Change feed ──────────────────────────────────────────────────────────

  watch(ws: WorkspaceId, cb: CloudWatchCallback): Unsubscribe {
    const notePaths = new Map<string, string>(); // noteId → path
    const cache = this.cache(ws);
    let notesReady = false;
    let foldersReady = false;

    // Note: the first snapshot bills one read per existing note (same as listTree).
    const stopNotes = onSnapshot(
      this.notes(ws),
      (snap) => {
        for (const change of snap.docChanges()) {
          const id = change.doc.id;
          const path = (change.doc.data() as NoteDoc).path;
          const prev = notePaths.get(id);
          if (change.type === 'removed') {
            notePaths.delete(id);
            if (cache.get(path) === id) cache.delete(path);
            if (notesReady) cb({ type: 'unlink', path });
            continue;
          }
          notePaths.set(id, path);
          cache.set(path, id);
          if (!notesReady) continue;
          if (change.type === 'added') cb({ type: 'add', path });
          else if (prev && prev !== path) {
            if (cache.get(prev) === id) cache.delete(prev);
            cb({ type: 'unlink', path: prev });
            cb({ type: 'add', path });
          } else cb({ type: 'change', path });
        }
        notesReady = true;
      },
      (error) => console.warn('[cloud] notes watch failed', error),
    );
    const stopFolders = onSnapshot(
      this.folders(ws),
      (snap) => {
        for (const change of snap.docChanges()) {
          const path = (change.doc.data() as FolderDoc).path;
          if (change.type === 'removed') {
            if (foldersReady) cb({ type: 'unlinkDir', path });
          } else if (change.type === 'added') {
            if (foldersReady) cb({ type: 'addDir', path });
          }
        }
        foldersReady = true;
      },
      (error) => console.warn('[cloud] folders watch failed', error),
    );
    return () => {
      stopNotes();
      stopFolders();
    };
  }

  // ── Sharing ──────────────────────────────────────────────────────────────

  createShare(ownerWs: WorkspaceId, input: CreateShareInput): Promise<{ shareId: string }> {
    return guard(async () => {
      if (!ownerWs) throw new PermissionError('Sign in to share');
      const payload = JSON.stringify(input.payload ?? null);
      this.checkSize(`share "${input.title}"`, payload);
      const ref = doc(this.shares());
      const record: ShareDoc = {
        ownerUid: ownerWs,
        kind: input.kind,
        title: input.title,
        payload,
        createdAt: now(),
      };
      // Plain set (not merge) on a fresh id is a `create` under the security rules.
      await setDoc(ref, record);
      return { shareId: ref.id };
    });
  }

  getShare(shareId: string): Promise<ShareRecord | null> {
    return guard(async () => {
      if (!shareId || shareId.includes('/')) return null;
      const snap = await getDoc(doc(this.shares(), shareId));
      if (!snap.exists()) return null;
      const data = snap.data() as ShareDoc;
      return { ...toShareMeta(snap.id, data), payload: JSON.parse(data.payload) as JsonValue };
    });
  }

  listMyShares(ownerWs: WorkspaceId): Promise<ShareMeta[]> {
    return guard(async () => {
      // Equality-only filter → no composite index; sorted client-side.
      const snap = await getDocs(query(this.shares(), where('ownerUid', '==', ownerWs)));
      return snap.docs
        .map((d) => toShareMeta(d.id, d.data() as ShareDoc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.shareId.localeCompare(a.shareId));
    });
  }

  deleteShare(ownerWs: WorkspaceId, shareId: string): Promise<void> {
    return guard(async () => {
      const ref = doc(this.shares(), shareId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new NotFoundError(`Share "${shareId}" not found`);
      if ((snap.data() as ShareDoc).ownerUid !== ownerWs) {
        throw new PermissionError('Only the owner can delete a share');
      }
      await deleteDoc(ref);
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────

  exportWorkspace(ws: WorkspaceId): Promise<WorkspaceExport> {
    return guard(async () => {
      const [noteSnap, folderSnap, dataSnap] = await Promise.all([
        getDocs(this.notes(ws)),
        getDocs(this.folders(ws)),
        getDocs(this.data(ws)),
      ]);
      const notes = noteSnap.docs
        .map((d) => {
          const data = d.data() as NoteDoc;
          return { path: data.path, body: data.body };
        })
        .sort((a, b) => a.path.localeCompare(b.path));
      const folders = folderSnap.docs.map((d) => (d.data() as FolderDoc).path).sort();

      // Reassemble chunked keys: sealed parts in order, then the head.
      const byKey = new Map<string, { head?: string; parts: Array<{ i: number; text: string }> }>();
      for (const d of dataSnap.docs) {
        const data = d.data() as DataDoc;
        const entry = byKey.get(data.key) ?? { parts: [] };
        if (typeof data.part === 'number') entry.parts.push({ i: data.part, text: data.text });
        else entry.head = data.text;
        byKey.set(data.key, entry);
      }
      const data = [...byKey.entries()]
        .filter(([, e]) => e.head !== undefined)
        .map(([key, e]) => ({
          key,
          text:
            e.parts
              .sort((a, b) => a.i - b.i)
              .map((p) => p.text)
              .join('') + e.head,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return { notes, folders, data };
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private user(ws: WorkspaceId): DocumentReference {
    if (!ws || ws.includes('/')) throw new PermissionError('No workspace (not signed in)');
    return doc(this.db, 'users', ws);
  }

  private notes(ws: WorkspaceId): CollectionReference {
    return collection(this.user(ws), 'notes');
  }

  private folders(ws: WorkspaceId): CollectionReference {
    return collection(this.user(ws), 'folders');
  }

  private data(ws: WorkspaceId): CollectionReference {
    return collection(this.user(ws), 'data');
  }

  private shares(): CollectionReference {
    return collection(this.db, 'shares');
  }

  private noteRef(ws: WorkspaceId, id: string): DocumentReference {
    return doc(this.notes(ws), id);
  }

  private folderRef(ws: WorkspaceId, path: string): DocumentReference {
    return doc(this.folders(ws), encodeDataKey(path));
  }

  private dataRef(ws: WorkspaceId, key: string, part?: number): DocumentReference {
    if (typeof key !== 'string' || !key) throw new InvalidPathError('Data key is empty');
    const id = encodeDataKey(key);
    return doc(this.data(ws), part === undefined ? id : `${id}~${part}`);
  }

  private cache(ws: WorkspaceId): Map<string, string> {
    let cache = this.idCache.get(ws);
    if (!cache) {
      cache = new Map();
      this.idCache.set(ws, cache);
    }
    return cache;
  }

  /** Query `path == p` (1 read). Updates the id cache. */
  private async findNote(
    ws: WorkspaceId,
    path: string,
  ): Promise<{ ref: DocumentReference; data: NoteDoc } | null> {
    const snap = await getDocs(query(this.notes(ws), where('path', '==', path), limit(1)));
    const d = snap.docs[0] as QueryDocumentSnapshot | undefined;
    if (!d) return null;
    this.cache(ws).set(path, d.id);
    return { ref: d.ref, data: d.data() as NoteDoc };
  }

  /** Range query for docs whose `path` is strictly under `folder/` (`0` sorts right after `/`). */
  private underPrefix(col: CollectionReference, folder: string) {
    return query(col, where('path', '>=', `${folder}/`), where('path', '<', `${folder}0`));
  }

  /** ConflictError when a note or folder already occupies `path`. */
  private async assertFree(ws: WorkspaceId, path: string): Promise<void> {
    const [noteAt, folderDoc, under] = await Promise.all([
      getDocs(query(this.notes(ws), where('path', '==', path), limit(1))),
      getDoc(this.folderRef(ws, path)),
      getDocs(query(this.underPrefix(this.notes(ws), path), limit(1))),
    ]);
    if (!noteAt.empty || folderDoc.exists() || !under.empty) {
      throw new ConflictError(`"${path}" already exists`);
    }
  }

  private async insertNote(ws: WorkspaceId, path: string, body: string): Promise<void> {
    const ref = doc(this.notes(ws));
    const record: NoteDoc = { path, body, updatedAt: now(), size: byteLength(body) };
    await this.commit([...this.folderOps(ws, ancestorFolders(path)), (b) => b.set(ref, record)]);
    this.cache(ws).set(path, ref.id);
  }

  /** Idempotent upserts for folder docs (deterministic ids, so no reads needed). */
  private folderOps(ws: WorkspaceId, folders: string[]): BatchOp[] {
    return folders.map((f) => (b: WriteBatch) => b.set(this.folderRef(ws, f), { path: f } satisfies FolderDoc));
  }

  /** Apply ops in batches of ≤ BATCH_LIMIT. Atomic only within one batch. */
  private async commit(ops: BatchOp[]): Promise<void> {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = writeBatch(this.db);
      for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
      await batch.commit();
    }
  }

  private checkSize(target: string, text: string): number {
    const bytes = byteLength(text);
    if (bytes > this.maxBytes) throw new PayloadTooLargeError(target, bytes, this.maxBytes);
    return bytes;
  }
}

function now(): string {
  return new Date().toISOString();
}

function toShareMeta(shareId: string, data: ShareDoc): ShareMeta {
  return { shareId, ownerWs: data.ownerUid, kind: data.kind, title: data.title, createdAt: data.createdAt };
}

/** Translate Firestore error codes into the backend-neutral CloudError types. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapError(error);
  }
}

function mapError(error: unknown): unknown {
  if (error instanceof CloudError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
      return new PermissionError(message);
    case 'not-found':
      return new NotFoundError(message);
    case 'already-exists':
      return new ConflictError(message);
    default:
      return error;
  }
}
