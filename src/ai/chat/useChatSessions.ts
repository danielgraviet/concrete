import { useEffect, useMemo } from 'react';
import { ChatSessionStore, memoryChatIO, vaultChatIO } from './sessionStore';

/**
 * One Study Chat session store per vault. It lives above the chat pane so
 * the conversation survives switching notes and closing the pane.
 */
export function useChatSessions(root: string | null, notePaths: string[]): ChatSessionStore {
  const store = useMemo(
    () => new ChatSessionStore(root && window.vault?.readData ? vaultChatIO(root) : memoryChatIO()),
    [root],
  );

  useEffect(() => {
    void store.load();
  }, [store]);

  // Bring per-note threads saved before sessions existed into the history.
  useEffect(() => {
    if (root && notePaths.length > 0) void store.importLegacy(notePaths);
  }, [store, root, notePaths]);

  return store;
}
