import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyWatchToFileList,
  applyWatchToFolderList,
  ensureFolderAncestors,
  parentDir,
} from './fileTree';
import { VaultService } from './VaultService';
import type { VaultWatchEvent } from './types';
import { filterWatchByRoot, subscribeVaultWatch } from './watch';

/**
 * Thin vault binding: open/list CRUD helpers + live file/folder lists.
 */
export function useVault(initialFiles: string[] = [], initialFolders: string[] = []) {
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>(initialFiles);
  const [folders, setFolders] = useState<string[]>(initialFolders);
  const rootRef = useRef(root);
  rootRef.current = root;

  useEffect(() => {
    if (!root) return;
    const handler = filterWatchByRoot(root, (event: VaultWatchEvent) => {
      if (event.type === 'add' || event.type === 'change' || event.type === 'unlink') {
        setFiles((current) => applyWatchToFileList(current, event));
      }
      if (event.type === 'addDir' || event.type === 'unlinkDir') {
        setFolders((current) => applyWatchToFolderList(current, event));
      }
    });
    return subscribeVaultWatch(handler);
  }, [root]);

  const open = useCallback(async () => {
    const result = await VaultService.open();
    if (!result) return null;
    setRoot(result.root);
    setFiles(result.files);
    setFolders(result.folders ?? []);
    return result;
  }, []);

  /** Open the default on-disk vault (Documents/Concrete). */
  const openDefault = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.vault?.ensureDefault !== 'function') {
      return null;
    }
    const result = await VaultService.ensureDefault();
    setRoot(result.root);
    setFiles(result.files);
    setFolders(result.folders ?? []);
    return result;
  }, []);

  const restore = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.vault?.restore !== 'function') return null;
    const result = await window.vault.restore();
    if (!result) return null;
    setRoot(result.root);
    setFiles(result.files);
    setFolders(result.folders ?? []);
    return result;
  }, []);

  const refresh = useCallback(async () => {
    const currentRoot = rootRef.current;
    if (!currentRoot) return { files: [], folders: [] };
    const next = await VaultService.list(currentRoot);
    setFiles(next.files);
    setFolders(next.folders);
    return next;
  }, []);

  const create = useCallback(async (name: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    const created = await VaultService.create(currentRoot, name);
    setFiles((current) =>
      current.includes(created)
        ? current
        : [...current, created].sort((a, b) => a.localeCompare(b)),
    );
    const parent = parentDir(created);
    if (parent) {
      setFolders((current) => ensureFolderAncestors(current, parent));
    }
    return created;
  }, []);

  const mkdir = useCallback(async (name: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    if (typeof window.vault?.mkdir !== 'function') {
      throw new Error('Folder create requires an Electron restart (mkdir IPC missing)');
    }
    const created = await VaultService.mkdir(currentRoot, name);
    setFolders((current) => ensureFolderAncestors(current, created));
    return created;
  }, []);

  const rename = useCallback(async (from: string, to: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    const next = await VaultService.rename(currentRoot, from, to);
    const isFolder = !from.toLowerCase().endsWith('.md');
    if (isFolder) {
      setFolders((current) =>
        current
          .map((folder) => {
            if (folder === from) return next;
            if (folder.startsWith(`${from}/`)) return `${next}${folder.slice(from.length)}`;
            return folder;
          })
          .sort((a, b) => a.localeCompare(b)),
      );
      setFiles((current) =>
        current
          .map((file) =>
            file.startsWith(`${from}/`) ? `${next}${file.slice(from.length)}` : file,
          )
          .sort((a, b) => a.localeCompare(b)),
      );
      return next;
    }
    setFiles((current) =>
      current
        .map((file) => (file === from ? next : file))
        .sort((a, b) => a.localeCompare(b)),
    );
    return next;
  }, []);

  const remove = useCallback(async (name: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    await VaultService.delete(currentRoot, name);
    const isFolder = !name.toLowerCase().endsWith('.md');
    if (isFolder) {
      setFolders((current) =>
        current.filter((folder) => folder !== name && !folder.startsWith(`${name}/`)),
      );
      setFiles((current) =>
        current.filter((file) => file !== name && !file.startsWith(`${name}/`)),
      );
      return true;
    }
    setFiles((current) => current.filter((file) => file !== name));
    return true;
  }, []);

  const read = useCallback(async (name: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    return VaultService.read(currentRoot, name);
  }, []);

  const write = useCallback(async (name: string, content: string) => {
    const currentRoot = rootRef.current;
    if (!currentRoot) throw new Error('No vault open');
    return VaultService.write(currentRoot, name, content);
  }, []);

  return {
    root,
    files,
    folders,
    setFiles,
    setFolders,
    open,
    openDefault,
    restore,
    refresh,
    create,
    mkdir,
    rename,
    delete: remove,
    read,
    write,
  };
}
