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
  /** Non-markdown documents also shown in the tree: PDFs and slide decks (.pptx). */
  pdfFiles: string[];
  folders: string[];
}

export interface VaultImportSummary {
  importedNotes: string[];
  skippedNotes: string[];
  removedFiles: string[];
  uncertainFilesKept: string[];
  preservedFiles: string[];
  skippedFiles: string[];
  copiedAssets: string[];
  warnings: string[];
}

export interface VaultImportResult extends VaultOpenResult {
  importSummary: VaultImportSummary;
}

export interface VaultListResult {
  files: string[];
  pdfFiles: string[];
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
