export type VaultWatchType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface VaultWatchEvent {
  type: VaultWatchType;
  /** Relative posix path within the vault root (e.g. `folder/Note.md`). */
  path: string;
  root: string;
}

export interface VaultOpenResult {
  root: string;
  files: string[];
  folders: string[];
}

export interface VaultListResult {
  files: string[];
  folders: string[];
}

export interface VaultFileNode {
  name: string;
  path: string;
  type: 'file';
}

export interface VaultFolderNode {
  name: string;
  path: string;
  type: 'folder';
  children: VaultTreeNode[];
}

export type VaultTreeNode = VaultFileNode | VaultFolderNode;
