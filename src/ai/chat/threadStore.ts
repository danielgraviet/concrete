/**
 * Per-note Study Chat threads, saved as `.vault/chat-<hash>.json` so a note's
 * conversation comes back when it is reopened. Notes stay free of chat data.
 */

export type StudyChatMode = 'chat' | 'agent';

export type StudyChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'log';
  mode: StudyChatMode;
  text: string;
  /** Note excerpt the user attached to this question. */
  quote?: string;
  /** Agent log line kind (status / file / command / error / message). */
  kind?: string;
  /** Vault-relative PDF paths produced by an agent turn. */
  pdfPaths?: string[];
  /** Reply was stopped or failed. */
  error?: boolean;
};

type StoredThread = {
  version: 1;
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

function threadFile(notePath: string): string {
  return `.vault/chat-${hashPath(notePath)}.json`;
}

/** Agent logs are progress noise; only the conversation is kept. */
function persistable(messages: StudyChatMessage[]): StudyChatMessage[] {
  return messages.filter((m) => m.role !== 'log');
}

export async function loadThread(root: string | null, notePath: string): Promise<StudyChatMessage[]> {
  if (!root || !notePath || !window.vault?.readData) return [];
  try {
    const raw = await window.vault.readData(root, threadFile(notePath));
    if (!raw) return [];
    const stored = JSON.parse(raw) as Partial<StoredThread>;
    // Hash collisions are possible; the stored path settles it.
    if (stored.path !== notePath || !Array.isArray(stored.messages)) return [];
    return stored.messages;
  } catch {
    return [];
  }
}

export async function saveThread(
  root: string | null,
  notePath: string,
  messages: StudyChatMessage[],
): Promise<void> {
  if (!root || !notePath || !window.vault?.writeData) return;
  const stored: StoredThread = {
    version: 1,
    path: notePath,
    updatedAt: Date.now(),
    messages: persistable(messages),
  };
  try {
    await window.vault.writeData(root, threadFile(notePath), JSON.stringify(stored));
  } catch {
    // Chat history is a convenience; never block the conversation on it.
  }
}
