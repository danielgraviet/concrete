import { legacyThreadFile, parseLegacyThread, persistable, type StudyChatMessage } from './threadStore';

/**
 * Vault-wide Study Chat sessions. A session follows the user from note to
 * note; each question records the note that was open when it was asked.
 *
 * On disk: `.vault/chat-sessions.json` (index: titles, timestamps, active
 * session) and one `.vault/chat-session-<id>.json` per transcript, loaded
 * lazily so the history list stays cheap however many sessions exist.
 */

export type ChatSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Notes the conversation touched, in first-asked order. */
  notePaths: string[];
};

/** Storage seam: the vault's `.vault/` data files, or memory (demo mode, tests). */
export type ChatDataIO = {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  remove(name: string): Promise<void>;
};

type SessionIndexFile = {
  version: 1;
  activeId: string | null;
  /** Per-note threads from before sessions have been imported. */
  legacyImported: boolean;
  sessions: ChatSessionMeta[];
};

type SessionFile = {
  version: 1;
  id: string;
  messages: StudyChatMessage[];
};

export const SESSION_INDEX_FILE = '.vault/chat-sessions.json';
const TITLE_MAX = 60;
const NO_MESSAGES: StudyChatMessage[] = [];

export function sessionFile(id: string): string {
  return `.vault/chat-session-${id}.json`;
}

export function vaultChatIO(root: string): ChatDataIO {
  return {
    read: async (name) => (await window.vault?.readData?.(root, name)) ?? null,
    write: async (name, content) => {
      await window.vault?.writeData?.(root, name, content);
    },
    remove: async (name) => {
      await window.vault?.deleteData?.(root, name);
    },
  };
}

export function memoryChatIO(files = new Map<string, string>()): ChatDataIO {
  return {
    read: async (name) => files.get(name) ?? null,
    write: async (name, content) => {
      files.set(name, content);
    },
    remove: async (name) => {
      files.delete(name);
    },
  };
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** First question, trimmed to one line. */
export function sessionTitle(messages: StudyChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.text.trim());
  if (!first) return 'New chat';
  const text = first.text.replace(/\s+/g, ' ').trim();
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

function notesOf(messages: StudyChatMessage[]): string[] {
  return [...new Set(messages.flatMap((m) => (m.role === 'user' && m.notePath ? [m.notePath] : [])))];
}

export class ChatSessionStore {
  private metas = new Map<string, ChatSessionMeta>();
  /** Transcripts loaded so far, by session id. */
  private threads = new Map<string, StudyChatMessage[]>();
  private currentId: string | null = null;
  private legacyImported = false;
  private ready: Promise<void> | null = null;
  private importing: Promise<void> | null = null;
  /** Writes run one at a time, in order, so the index never goes backwards. */
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private sorted: ChatSessionMeta[] | null = null;
  version = 0;

  constructor(private readonly io: ChatDataIO) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Read the index and the active transcript. Safe to call repeatedly. */
  load(): Promise<void> {
    this.ready ??= this.readIndex();
    return this.ready;
  }

  /** Session the next question goes into; null until the first question of a new chat. */
  get activeId(): string | null {
    return this.currentId;
  }

  /** Saved sessions, most recently used first. */
  sessions(): ChatSessionMeta[] {
    this.sorted ??= [...this.metas.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return this.sorted;
  }

  messages(id: string | null = this.currentId): StudyChatMessage[] {
    return (id && this.threads.get(id)) || NO_MESSAGES;
  }

  /** The active session's id, starting a session if this is a new chat. */
  ensureActive(): string {
    if (this.currentId) return this.currentId;
    const id = newSessionId();
    this.currentId = id;
    this.threads.set(id, []);
    this.emit();
    return id;
  }

  /** Start a fresh chat; the current one stays in history. */
  startNew(): void {
    if (this.currentId === null) return;
    this.currentId = null;
    this.emit();
    this.enqueue(this.writeIndex);
  }

  async open(id: string): Promise<void> {
    if (!this.metas.has(id)) return;
    await this.loadThread(id);
    this.currentId = id;
    this.emit();
    this.enqueue(this.writeIndex);
  }

  /** Change a session's transcript in memory; call save() once the turn settles. */
  update(id: string, fn: (messages: StudyChatMessage[]) => StudyChatMessage[]): void {
    const messages = fn(this.threads.get(id) ?? []);
    this.threads.set(id, messages);
    if (messages.some((m) => m.role === 'user')) {
      const now = Date.now();
      this.metas.set(id, {
        id,
        title: sessionTitle(messages),
        createdAt: this.metas.get(id)?.createdAt ?? now,
        updatedAt: now,
        notePaths: notesOf(messages),
      });
    }
    this.emit();
  }

  save(id: string): void {
    const messages = persistable(this.threads.get(id) ?? []);
    if (!this.metas.has(id) || messages.length === 0) return;
    const file: SessionFile = { version: 1, id, messages };
    this.enqueue(() => this.io.write(sessionFile(id), JSON.stringify(file)));
    this.enqueue(this.writeIndex);
  }

  remove(id: string): void {
    if (!this.metas.delete(id)) return;
    this.threads.delete(id);
    if (this.currentId === id) this.currentId = null;
    this.emit();
    this.enqueue(() => this.io.remove(sessionFile(id)));
    this.enqueue(this.writeIndex);
  }

  /**
   * One-time import of the old per-note threads as sessions. Their files are
   * left in place, so nothing is lost if the import is interrupted.
   */
  async importLegacy(notePaths: string[]): Promise<void> {
    await this.load();
    if (this.legacyImported) return;
    this.importing ??= this.readLegacy(notePaths);
    return this.importing;
  }

  /** Resolves when every queued write has finished. */
  flush(): Promise<void> {
    return this.writes;
  }

  private async readIndex(): Promise<void> {
    try {
      const raw = await this.io.read(SESSION_INDEX_FILE);
      const index = raw ? (JSON.parse(raw) as Partial<SessionIndexFile>) : {};
      for (const meta of index.sessions ?? []) this.metas.set(meta.id, meta);
      this.legacyImported = Boolean(index.legacyImported);
      if (index.activeId && this.metas.has(index.activeId)) this.currentId = index.activeId;
    } catch {
      // A corrupt index starts a fresh history; session files stay on disk.
    }
    if (this.currentId) await this.loadThread(this.currentId);
    this.emit();
  }

  private async readLegacy(notePaths: string[]): Promise<void> {
    const threads = await Promise.all(
      notePaths.map(async (path) =>
        parseLegacyThread(await this.io.read(legacyThreadFile(path)).catch(() => null), path),
      ),
    );
    for (const thread of threads) {
      const messages = persistable(thread?.messages ?? []).map((m) => ({
        ...m,
        notePath: m.notePath ?? thread!.path,
      }));
      if (!thread || !messages.some((m) => m.role === 'user')) continue;
      const id = newSessionId();
      const at = thread.updatedAt || Date.now();
      this.metas.set(id, { id, title: sessionTitle(messages), createdAt: at, updatedAt: at, notePaths: [thread.path] });
      // Written straight to disk; transcripts load lazily when opened.
      const file: SessionFile = { version: 1, id, messages };
      this.enqueue(() => this.io.write(sessionFile(id), JSON.stringify(file)));
    }
    this.legacyImported = true;
    this.emit();
    this.enqueue(this.writeIndex);
  }

  private async loadThread(id: string): Promise<void> {
    if (this.threads.has(id)) return;
    await this.writes;
    let messages: StudyChatMessage[] = [];
    try {
      const raw = await this.io.read(sessionFile(id));
      const file = raw ? (JSON.parse(raw) as Partial<SessionFile>) : {};
      if (Array.isArray(file.messages)) messages = file.messages;
    } catch {
      // Unreadable transcript opens empty rather than blocking the chat.
    }
    if (!this.threads.has(id)) this.threads.set(id, messages);
  }

  private writeIndex = (): Promise<void> => {
    const index: SessionIndexFile = {
      version: 1,
      activeId: this.currentId && this.metas.has(this.currentId) ? this.currentId : null,
      legacyImported: this.legacyImported,
      sessions: [...this.metas.values()],
    };
    return this.io.write(SESSION_INDEX_FILE, JSON.stringify(index));
  };

  private enqueue(task: () => Promise<void>): void {
    // Chat history is a convenience; a failed write never blocks the conversation.
    this.writes = this.writes.then(task).catch(() => undefined);
  }

  private emit(): void {
    this.sorted = null;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
