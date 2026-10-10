import type { VaultImportResult, VaultListResult, VaultOpenResult, VaultWatchEvent } from './types';
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

  readPdf(root: string, name: string): Promise<Uint8Array> {
    const api = requireVault();
    if (typeof api.readPdf !== 'function') throw new Error('PDF reading requires an Electron restart after updating');
    return api.readPdf(root, name);
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

  importObsidian(root: string): Promise<VaultOpenResult | null> {
    const api = requireVault();
    if (typeof api.importObsidian !== 'function') {
      throw new Error('Obsidian import requires an Electron restart');
    }
    return api.importObsidian(root);
  },

  importNotion(root: string | null): Promise<VaultImportResult | null> {
    const api = requireVault();
    if (typeof api.importNotion !== 'function') {
      throw new Error('Notion import requires an Electron restart');
    }
    return api.importNotion(root ?? '');
  },

  rename(root: string, from: string, to: string): Promise<string> {
    return requireVault().rename(root, from, to);
  },

  delete(root: string, name: string): Promise<boolean> {
    return requireVault().delete(root, name);
  },

  /** Opens a vault-relative file with the OS default app (e.g. a PDF viewer). */
  openPath(root: string, name: string): Promise<boolean> {
    return requireVault().openPath(root, name);
  },

  /** Reveals a vault-relative file in Finder / Explorer. */
  revealInFolder(root: string, name: string): Promise<boolean> {
    return requireVault().revealInFolder(root, name);
  },

  /** Picks a Markdown or PDF file from disk and copies it into `folder`. Null when cancelled. */
  importFile(root: string, folder: string): Promise<string | null> {
    return requireVault().importFile(root, folder);
  },

  /** Raw text per page of a vault PDF. */
  extractPdfText(root: string, name: string): Promise<{ pages: string[]; totalPages: number }> {
    return requireVault().extractPdfText(root, name);
  },

  /** Render a note to a PDF saved beside it. Returns the vault-relative path. */
  exportNotePdf(root: string, notePath: string, markdown: string, title: string): Promise<string> {
    const exportNote = requireVault().exportNotePdf;
    if (!exportNote) throw new Error('Restart Concrete to export PDFs.');
    return exportNote({ root, notePath, markdown, title });
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
