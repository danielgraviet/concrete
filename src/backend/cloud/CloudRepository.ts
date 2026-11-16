/**
 * Storage contract for the web version of Concrete.
 *
 * This file must stay free of any vendor types (no Firebase, no SQL). Every
 * value crossing it is plain JSON: strings, numbers, arrays, objects, with
 * timestamps as ISO-8601 strings. Firebase is one implementation
 * (`firebase/FirebaseCloudRepository`); a Postgres/HTTP implementation can
 * replace it without touching the app.
 *
 * The API mirrors the desktop vault preload bridge: notes are
 * addressed by vault-relative paths like `Stats/Bayes.md`, folders by paths
 * like `Stats/Charts`, and app data (`.vault/srs.json`, `.vault/srs-log.jsonl`,
 * ...) by key. Everything is scoped to a workspace id — for now the signed-in
 * user's uid.
 *
 * Errors: implementations throw the typed errors from `./errors`
 * (NotFoundError, ConflictError, PayloadTooLargeError, PermissionError,
 * InvalidPathError).
 */

export type WorkspaceId = string;

/** ISO-8601 timestamp string, e.g. `2026-11-14T19:13:45.632Z`. */
export type IsoTimestamp = string;

export interface NoteMeta {
  /** Stable id; survives renames. */
  id: string;
  /** Vault-relative path, `/`-separated, e.g. `Stats/Bayes.md`. */
  path: string;
  updatedAt: IsoTimestamp;
  /** UTF-8 byte length of the body. */
  size: number;
}

export interface CloudTree {
  /** Sorted by path. */
  notes: NoteMeta[];
  /** Every folder: explicitly created ones plus all ancestors of notes. Sorted. */
  folders: string[];
}

/** Same event names as the desktop chokidar watcher (`VaultWatchType`). */
export type CloudWatchType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface CloudWatchEvent {
  type: CloudWatchType;
  path: string;
}

export type CloudWatchCallback = (event: CloudWatchEvent) => void;

export type Unsubscribe = () => void;

/** JSON-serializable value (what a share payload may contain). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ShareKind = 'note' | 'folder' | 'deck' | 'quiz';

export interface CreateShareInput {
  kind: ShareKind;
  title: string;
  /** Frozen snapshot of the shared content. Serialized as JSON; ~900 KB max. */
  payload: JsonValue;
}

export interface ShareMeta {
  shareId: string;
  ownerWs: WorkspaceId;
  kind: ShareKind;
  title: string;
  createdAt: IsoTimestamp;
}

export interface ShareRecord extends ShareMeta {
  payload: JsonValue;
}

export interface WorkspaceExport {
  notes: Array<{ path: string; body: string }>;
  /** Explicit folders (including empty ones), sorted. */
  folders: string[];
  data: Array<{ key: string; text: string }>;
}

export interface CloudRepository {
  // ── Notes & folders ──────────────────────────────────────────────────────

  /** All note metadata (no bodies) and all folders. */
  listTree(ws: WorkspaceId): Promise<CloudTree>;

  /** Note body, or null when no note exists at `path`. */
  readNote(ws: WorkspaceId, path: string): Promise<string | null>;

  /** Upsert a note body. Throws PayloadTooLargeError above the size limit. */
  writeNote(ws: WorkspaceId, path: string, body: string): Promise<void>;

  /**
   * Create a new note like the desktop app: `name` may be nested
   * (`folder/Note`) and `.md` is appended when missing. The body defaults to
   * `# <Title>\n\n`. Throws ConflictError when the note exists. Returns the
   * normalized path.
   */
  createNote(ws: WorkspaceId, name: string, body?: string): Promise<string>;

  /** Create a folder (nested allowed). Idempotent. Returns the normalized path. */
  mkdir(ws: WorkspaceId, path: string): Promise<string>;

  /**
   * Rename/move a note or a folder. A folder rename moves every note and
   * subfolder under the prefix. For notes, `.md` is appended to `to` when
   * missing. Throws NotFoundError (no source), ConflictError (destination
   * exists), InvalidPathError (folder into itself). Returns the new path.
   */
  rename(ws: WorkspaceId, from: string, to: string): Promise<string>;

  /** Delete a note, or a folder and everything under it. NotFoundError if neither exists. */
  remove(ws: WorkspaceId, path: string): Promise<void>;

  // ── App data (the desktop `.vault/` files) ───────────────────────────────

  /** Stored text for `key` (JSON or JSONL), or null when absent. */
  readData(ws: WorkspaceId, key: string): Promise<string | null>;

  /** Replace the text for `key`. Throws PayloadTooLargeError above the size limit. */
  writeData(ws: WorkspaceId, key: string, text: string): Promise<void>;

  /**
   * Append `line` verbatim (include the trailing `\n` yourself, as with the
   * desktop `appendData`). Append-only logs may grow past the per-record
   * limit: implementations split them transparently. Only a single line
   * above the limit throws PayloadTooLargeError.
   */
  appendData(ws: WorkspaceId, key: string, line: string): Promise<void>;

  /** Delete `key`. No-op when absent. */
  deleteData(ws: WorkspaceId, key: string): Promise<void>;

  // ── Change feed ──────────────────────────────────────────────────────────

  /**
   * Subscribe to note/folder changes made from any client (including this
   * one). Does not replay the current state — call listTree for that.
   * Optional: callers fall back to re-listing when absent.
   */
  watch?(ws: WorkspaceId, cb: CloudWatchCallback): Unsubscribe;

  // ── Sharing (frozen snapshots, no live permissions) ──────────────────────

  createShare(ownerWs: WorkspaceId, input: CreateShareInput): Promise<{ shareId: string }>;

  /** Readable by anyone, including signed-out visitors. Null when missing. */
  getShare(shareId: string): Promise<ShareRecord | null>;

  /** Newest first. */
  listMyShares(ownerWs: WorkspaceId): Promise<ShareMeta[]>;

  /** NotFoundError when missing, PermissionError when owned by someone else. */
  deleteShare(ownerWs: WorkspaceId, shareId: string): Promise<void>;

  // ── Export / migration ───────────────────────────────────────────────────

  /** Everything in the workspace, for zip export and backend migration. */
  exportWorkspace(ws: WorkspaceId): Promise<WorkspaceExport>;
}

/** Firestore caps documents at 1 MiB; keep headroom for field names/metadata. */
export const MAX_PAYLOAD_BYTES = 900_000;
