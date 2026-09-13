import type { VaultWatchEvent } from './types';

export type VaultWatchCallback = (event: VaultWatchEvent) => void;

/**
 * Subscribe to vault filesystem watch events from the main process.
 * Returns an unsubscribe function (also callable via `offWatch`).
 */
export function subscribeVaultWatch(callback: VaultWatchCallback): () => void {
  if (typeof window === 'undefined' || !window.vault?.onWatch) {
    return () => {};
  }
  return window.vault.onWatch(callback);
}

export function unsubscribeVaultWatch(callback: VaultWatchCallback): void {
  window.vault?.offWatch?.(callback);
}

/** Filter watch events to a specific vault root (resolved path). */
export function filterWatchByRoot(
  root: string,
  callback: VaultWatchCallback
): VaultWatchCallback {
  return (event) => {
    if (event.root !== root) return;
    callback(event);
  };
}
