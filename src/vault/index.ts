export type {
  VaultFileNode,
  VaultFolderNode,
  VaultListResult,
  VaultOpenResult,
  VaultTreeNode,
  VaultWatchEvent,
  VaultWatchType,
} from './types';

export {
  applyWatchToFileList,
  applyWatchToFolderList,
  buildFileTree,
  ensureFolderAncestors,
  filesInFolder,
  isPdfFileName,
  isHiddenVaultFile,
  isQuizFileName,
  joinNotePath,
  joinPdfPath,
  joinFolderPath,
  noteTitle,
  parentDir,
  toPosixPath,
} from './fileTree';

export {
  filterWatchByRoot,
  subscribeVaultWatch,
  unsubscribeVaultWatch,
  type VaultWatchCallback,
} from './watch';

export { VaultService, canMkdir, canUseDiskVault } from './VaultService';
export { useVault } from './hooks';
export { FileTreeView, type TreeItemKind } from './FileTreeView';
export { askText } from './askText';
export { NoteBodyCache } from './NoteBodyCache';
