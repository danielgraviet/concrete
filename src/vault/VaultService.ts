import type { VaultListResult, VaultOpenResult, VaultWatchEvent } from './types';
import { subscribeVaultWatch, type VaultWatchCallback } from './watch';

function requireVault() {
  if (typeof window === 'undefined' || !window.vault) {
    throw new Error('Vault API is only available in the Electron renderer');
  }
  return window.vault;
}

/** True when a vault root is open and the Electron bridge is present. */
export function canUseDiskVault(root: string | null | undefined): root is string {
  return Boolean(root && typeof window !== 'undefined' && window.vault);
}

/** True when `vault.mkdir` is available (requires Electron restart after upgrade). */
export function canMkdir(): boolean {
  return typeof window !== 'undefined' && typeof window.vault?.mkdir === 'function';
}

/** Typed wrapper around `window.vault` IPC bridge. */
export const VaultService = {
  open(): Promise<VaultOpenResult | null> {
    return requireVault().open();
  },

  list(root: string): Promise<VaultListResult> {
    return requireVault().list(root);
  },

  read(root: string, name: string): Promise<string> {
    return requireVault().read(root, name);
  },

  write(root: string, name: string, content: string): Promise<boolean> {
    return requireVault().write(root, name, content);
  },

  /** Create a note; `name` may be nested (`folder/Note` or `folder/Note.md`). */
  create(root: string, name: string): Promise<string> {
    return requireVault().create(root, name);
  },

  /** Create a folder (nested paths allowed: `stats/charts`). */
  mkdir(root: string, name: string): Promise<string> {
    const api = requireVault();
    if (typeof api.mkdir !== 'function') {
      throw new Error('Folder create requires an Electron restart (mkdir IPC missing)');
    }
    return api.mkdir(root, name);
  },

  /** Create/open Documents/Concrete and start watching it. */
  ensureDefault(): Promise<VaultOpenResult> {
    const api = requireVault();
    if (typeof api.ensureDefault !== 'function') {
      throw new Error('Default vault requires an Electron restart (ensureDefault IPC missing)');
    }
    return api.ensureDefault();
  },

  rename(root: string, from: string, to: string): Promise<string> {
    return requireVault().rename(root, from, to);
  },

  delete(root: string, name: string): Promise<boolean> {
    return requireVault().delete(root, name);
  },

  watchStart(root: string): Promise<boolean> {
    return requireVault().watchStart(root);
  },

  watchStop(): Promise<boolean> {
    return requireVault().watchStop();
  },

  onWatch(callback: VaultWatchCallback): () => void {
    return subscribeVaultWatch(callback);
  },

  offWatch(callback: VaultWatchCallback): void {
    requireVault().offWatch(callback);
  },
};

export type { VaultOpenResult, VaultWatchEvent, VaultListResult };
