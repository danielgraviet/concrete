/**
 * Study Chat message types, plus the reader for the legacy per-note thread
 * files (`.vault/chat-<hash>.json`) that sessions are migrated from.
 */

export type StudyChatMode = 'chat' | 'agent';

export type StudyChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'log';
  mode: StudyChatMode;
  text: string;
  /** Note open when this question was asked; sessions follow the user across notes. */
  notePath?: string;
  /** Note excerpt the user attached to this question. */
  quote?: string;
  /** Agent log line kind (status / file / command / error / message). */
  kind?: string;
  /** Vault-relative PDF paths produced by an agent turn. */
  pdfPaths?: string[];
  /** Reply was stopped or failed. */
  error?: boolean;
};

export type LegacyThread = {
  path: string;
  updatedAt: number;
  messages: StudyChatMessage[];
};

/** FNV-1a, enough to give each note path a stable data-file name. */
function hashPath(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function legacyThreadFile(notePath: string): string {
  return `.vault/chat-${hashPath(notePath)}.json`;
}

/** Agent logs are progress noise; only the conversation is kept. */
export function persistable(messages: StudyChatMessage[]): StudyChatMessage[] {
  return messages.filter((m) => m.role !== 'log');
}

/** Parse a legacy thread file; null when missing, malformed, or another note's (hash collision). */
export function parseLegacyThread(raw: string | null, notePath: string): LegacyThread | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<LegacyThread>;
    if (stored.path !== notePath || !Array.isArray(stored.messages)) return null;
    return {
      path: notePath,
      updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : 0,
      messages: stored.messages,
    };
  } catch {
    return null;
  }
}
