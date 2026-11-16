/**
 * Synchronous write-ahead journal for the cloud vault (web only).
 *
 * The cloud vault buffers writes in memory for a few seconds and then writes
 * them to Firestore. A network write cannot finish while the browser is
 * closing the tab, so buffered edits would be lost on close. Every buffered
 * change is therefore also written, synchronously, to `localStorage`. The
 * next time the vault opens it replays whatever a dead tab left behind (see
 * `cloudVault.ts`).
 *
 * Storage layout (all keys are scoped to the signed-in user's uid):
 *
 *   concrete:journal:<uid>:<slotId>   → JSON JournalEntry
 *   concrete:journal-tab:<uid>:<tab>  → last heartbeat (ms since epoch)
 *
 * A *slot* holds one pending change. Note and data writes reuse their slot
 * while the change sits in the buffer (latest content wins); appends get one
 * slot per call. Once the buffered change is handed to the repository the
 * slot is frozen: a newer edit goes into a new slot, and the frozen one is
 * removed only after the repository confirmed that exact write.
 *
 * Multiple tabs: tabs of the same user share the key space. Each entry
 * records its owning tab, and each tab refreshes a heartbeat while it is open
 * and deletes it on `pagehide`. Only entries whose owner has no fresh
 * heartbeat are replayed, and a tab claims an entry (rewrites its owner) under
 * a Web Lock before replaying it, so two tabs never replay the same entry. A
 * tab only removes entries it still owns.
 */

export type JournalKind = 'note' | 'data' | 'append';

export interface JournalEntry {
  /** Slot id: `<tabId>.<n>`; also the storage key suffix. */
  id: string;
  /** Owning tab. */
  tab: string;
  kind: JournalKind;
  /** Note path or data key. */
  key: string;
  content: string;
  /** When this content was written locally (ms since epoch). */
  ts: number;
  /** Increases on every write by this tab; identifies a version of the slot. */
  seq: number;
}

export interface SlotRef {
  id: string;
  seq: number;
}

/** The subset of `Storage` the journal needs (fake it in tests). */
export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** Minimal `navigator.locks` shape. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

export interface WriteJournal {
  readonly tabId: string;
  /**
   * Store `content` synchronously, in `slotId` when given (it must belong to
   * this tab), otherwise in a new slot. Returns null when it could not be
   * stored (too large, quota exceeded, storage error).
   */
  put(slotId: string | null, kind: JournalKind, key: string, content: string): JournalEntry | null;
  /** Remove a slot if it still holds version `ref.seq` and this tab owns it. */
  remove(ref: SlotRef): void;
  /** Refresh this tab's heartbeat. */
  heartbeat(): void;
  /** This tab is going away: drop its heartbeat so other tabs may replay its entries. */
  markClosed(): void;
  /**
   * Claim every entry whose owning tab is gone (rewrite it as owned by this
   * tab) and return the claimed entries, oldest first. Run it under `withLock`.
   */
  claimOrphans(): JournalEntry[];
  /** Run `fn` holding the per-user journal lock (Web Locks when available). */
  withLock<T>(fn: () => Promise<T> | T): Promise<T>;
}

export interface WriteJournalOptions {
  storage: JournalStorage;
  uid: string;
  tabId?: string;
  now?: () => number;
  /** A heartbeat older than this means the tab is gone (default 90 s; hidden tabs tick at most once a minute). */
  liveMs?: number;
  /** Larger entries are not journaled (default 600k chars ≈ 1.2 MB of localStorage). */
  maxEntryChars?: number;
  /** Defaults to `navigator.locks` when present. Null runs `withLock` callbacks directly. */
  locks?: LockManagerLike | null;
  log?: (message: string, error?: unknown) => void;
}

export const DEFAULT_LIVE_MS = 90_000;
export const DEFAULT_MAX_ENTRY_CHARS = 600_000;
const ENTRY_PREFIX = 'concrete:journal:';
const TAB_PREFIX = 'concrete:journal-tab:';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 14);
}

function parseEntry(text: string | null): JournalEntry | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<JournalEntry>;
    if (
      typeof value?.id === 'string' &&
      typeof value.tab === 'string' &&
      (value.kind === 'note' || value.kind === 'data' || value.kind === 'append') &&
      typeof value.key === 'string' &&
      typeof value.content === 'string' &&
      typeof value.ts === 'number' &&
      typeof value.seq === 'number'
    ) {
      return value as JournalEntry;
    }
  } catch {
    // corrupt entry: ignored
  }
  return null;
}

function defaultLocks(): LockManagerLike | null {
  const nav = typeof navigator !== 'undefined' ? (navigator as { locks?: LockManagerLike }) : undefined;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

/** `window.localStorage` behind the journal interface, or null when unusable (blocked, private mode quirks). */
export function browserJournalStorage(): JournalStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const ls = window.localStorage;
    const probe = `${ENTRY_PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (key) => ls.getItem(key),
      setItem: (key, value) => ls.setItem(key, value),
      removeItem: (key) => ls.removeItem(key),
      keys: () => {
        const out: string[] = [];
        for (let i = 0; i < ls.length; i += 1) {
          const key = ls.key(i);
          if (key !== null) out.push(key);
        }
        return out;
      },
    };
  } catch {
    return null;
  }
}

export function createWriteJournal(options: WriteJournalOptions): WriteJournal {
  const { storage, uid } = options;
  const tabId = options.tabId ?? randomId();
  const now = options.now ?? (() => Date.now());
  const liveMs = options.liveMs ?? DEFAULT_LIVE_MS;
  const maxEntryChars = options.maxEntryChars ?? DEFAULT_MAX_ENTRY_CHARS;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const log = options.log ?? ((message: string, error?: unknown) => console.warn(`[journal] ${message}`, error ?? ''));

  const entryPrefix = `${ENTRY_PREFIX}${uid}:`;
  const tabPrefix = `${TAB_PREFIX}${uid}:`;
  const entryKey = (id: string) => entryPrefix + id;
  let counter = 0;
  let seq = 0;

  function read(id: string): JournalEntry | null {
    try {
      return parseEntry(storage.getItem(entryKey(id)));
    } catch {
      return null;
    }
  }

  function heartbeat(): void {
    try {
      storage.setItem(tabPrefix + tabId, String(now()));
    } catch {
      // Best effort: a missing heartbeat only lets another tab replay early.
    }
  }

  function isAlive(tab: string): boolean {
    if (tab === tabId) return true;
    try {
      const beat = Number(storage.getItem(tabPrefix + tab));
      return Number.isFinite(beat) && beat > 0 && now() - beat < liveMs;
    } catch {
      return false;
    }
  }

  return {
    tabId,

    put(slotId, kind, key, content) {
      if (content.length > maxEntryChars) {
        log(`"${key}" is too large to journal (${content.length} chars); it is only kept in memory until it is saved.`);
        return null;
      }
      seq += 1;
      const id = slotId ?? `${tabId}.${(counter += 1).toString(36)}`;
      const entry: JournalEntry = { id, tab: tabId, kind, key, content, ts: now(), seq };
      try {
        storage.setItem(entryKey(id), JSON.stringify(entry));
      } catch (error) {
        log(`could not journal "${key}"`, error);
        return null;
      }
      heartbeat();
      return entry;
    },

    remove(ref) {
      const stored = read(ref.id);
      if (!stored || stored.tab !== tabId || stored.seq !== ref.seq) return;
      try {
        storage.removeItem(entryKey(ref.id));
      } catch {
        // Left behind: replayed (idempotently) by a later session.
      }
    },

    heartbeat,

    markClosed() {
      try {
        storage.removeItem(tabPrefix + tabId);
      } catch {
        // ignore
      }
    },

    claimOrphans() {
      let keys: string[];
      try {
        keys = storage.keys();
      } catch {
        return [];
      }
      const claimed: JournalEntry[] = [];
      const deadTabs = new Set<string>();
      const tabsWithEntries = new Set<string>();
      for (const key of keys) {
        if (!key.startsWith(entryPrefix)) continue;
        const id = key.slice(entryPrefix.length);
        const entry = read(id);
        if (!entry) continue;
        tabsWithEntries.add(entry.tab);
        if (entry.tab === tabId || isAlive(entry.tab)) continue;
        deadTabs.add(entry.tab);
        const mine: JournalEntry = { ...entry, id, tab: tabId };
        try {
          storage.setItem(key, JSON.stringify(mine));
        } catch (error) {
          log(`could not claim journal entry for "${entry.key}"`, error);
          continue;
        }
        seq = Math.max(seq, entry.seq);
        claimed.push(mine);
      }
      // Forget heartbeats of tabs that are gone and left nothing behind.
      for (const key of keys) {
        if (!key.startsWith(tabPrefix)) continue;
        const tab = key.slice(tabPrefix.length);
        if (tab === tabId || (tabsWithEntries.has(tab) && !deadTabs.has(tab)) || isAlive(tab)) continue;
        try {
          storage.removeItem(key);
        } catch {
          // ignore
        }
      }
      if (claimed.length) heartbeat();
      return claimed.sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.id.localeCompare(b.id));
    },

    async withLock(fn) {
      if (!locks) return fn();
      let ran = false;
      try {
        return await locks.request(`concrete:journal:${uid}`, () => {
          ran = true;
          return fn();
        });
      } catch (error) {
        if (ran) throw error;
        // A broken Lock API must not block startup.
        log('journal lock unavailable', error);
        return fn();
      }
    },
  };
}
