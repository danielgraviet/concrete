import type { VaultFolderNode, VaultTreeNode, VaultWatchEvent } from './types';

/** Normalize separators to posix-style relative paths. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Display title for a note path (`folder/Note.md` → `Note`). */
export function noteTitle(relativePath: string): string {
  const base = toPosixPath(relativePath).split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '');
}

/** True when basename (sans .md) starts with `Quiz `. */
export function isQuizFileName(name: string): boolean {
  const base = toPosixPath(name).split('/').pop() ?? name;
  return /^Quiz /.test(base.replace(/\.md$/i, ''));
}

/** Sort rank: folders first, then notes, quizzes last. */
function treeSortRank(node: VaultTreeNode): number {
  if (node.type === 'folder') return 0;
  return isQuizFileName(node.name) ? 2 : 1;
}

/** Parent folder relative path, or `''` for vault root files. */
export function parentDir(relativePath: string): string {
  const parts = toPosixPath(relativePath).split('/');
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/');
}

/** Merge a folder path and all ancestors into a flat folder list. */
export function ensureFolderAncestors(
  folders: string[],
  folderPath: string,
): string[] {
  const normalized = toPosixPath(folderPath).replace(/^\/+|\/+$/g, '');
  if (!normalized) return folders;
  const next = new Set(folders);
  const parts = normalized.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    next.add(parts.slice(0, i + 1).join('/'));
  }
  return [...next].sort((a, b) => a.localeCompare(b));
}

/** Join a vault-relative parent folder with a folder name. */
export function joinFolderPath(folder: string, name: string): string {
  const cleaned = toPosixPath(name).replace(/^\/+|\/+$/g, '');
  const base = cleaned.split('/').filter(Boolean).pop() ?? cleaned;
  if (!base || base === '..' || base.startsWith('.')) return '';
  const parent = toPosixPath(folder).replace(/^\/+|\/+$/g, '');
  return parent ? `${parent}/${base}` : base;
}

/** Join a vault-relative folder with a note name → `Folder/Name.md`. */
export function joinNotePath(folder: string, name: string): string {
  const cleaned = toPosixPath(name)
    .replace(/\.md$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const base = cleaned.split('/').filter(Boolean).pop() ?? cleaned;
  if (!base) return '';
  const file = `${base}.md`;
  const parent = toPosixPath(folder).replace(/^\/+|\/+$/g, '');
  return parent ? `${parent}/${file}` : file;
}

/**
 * Build a nested folder/file tree from flat relative markdown paths
 * plus optional empty folder paths.
 */
export function buildFileTree(
  paths: string[],
  emptyFolders: string[] = [],
): VaultFolderNode {
  const root: VaultFolderNode = {
    name: '',
    path: '',
    type: 'folder',
    children: [],
  };

  const folders = new Map<string, VaultFolderNode>([['', root]]);

  const ensureFolder = (folderPath: string): VaultFolderNode => {
    const existing = folders.get(folderPath);
    if (existing) return existing;

    const parentPath = parentDir(folderPath);
    const parent = ensureFolder(parentPath);
    const name = folderPath.split('/').pop() ?? folderPath;
    const node: VaultFolderNode = {
      name,
      path: folderPath,
      type: 'folder',
      children: [],
    };
    parent.children.push(node);
    folders.set(folderPath, node);
    return node;
  };

  for (const folderPath of emptyFolders) {
    const normalized = toPosixPath(folderPath).replace(/^\/+|\/+$/g, '');
    if (normalized) ensureFolder(normalized);
  }

  for (const raw of paths) {
    const filePath = toPosixPath(raw);
    if (!filePath) continue;
    const folderPath = parentDir(filePath);
    const folder = ensureFolder(folderPath);
    const name = filePath.split('/').pop() ?? filePath;
    folder.children.push({
      name,
      path: filePath,
      type: 'file',
    });
  }

  const sortNodes = (nodes: VaultTreeNode[]) => {
    nodes.sort((a, b) => {
      const rankDiff = treeSortRank(a) - treeSortRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === 'folder') sortNodes(node.children);
    }
  };

  sortNodes(root.children);
  return root;
}

/** Apply a watch event to a flat file list (immutable). */
export function applyWatchToFileList(
  files: string[],
  event: Pick<VaultWatchEvent, 'type' | 'path'>,
): string[] {
  const path = toPosixPath(event.path);
  if (event.type === 'unlink') {
    return files.filter((file) => file !== path);
  }
  if (event.type === 'add') {
    if (files.includes(path)) return files;
    return [...files, path].sort((a, b) => a.localeCompare(b));
  }
  return files;
}

/** Apply a watch event to a flat folder list (immutable). */
export function applyWatchToFolderList(
  folders: string[],
  event: Pick<VaultWatchEvent, 'type' | 'path'>,
): string[] {
  const path = toPosixPath(event.path).replace(/^\/+|\/+$/g, '');
  if (!path) return folders;
  if (event.type === 'unlinkDir') {
    return folders.filter(
      (folder) => folder !== path && !folder.startsWith(`${path}/`),
    );
  }
  if (event.type === 'addDir') {
    if (folders.includes(path)) return folders;
    return [...folders, path].sort((a, b) => a.localeCompare(b));
  }
  return folders;
}

/** Filter a flat note list by search / folder scope. */
export function filesInFolder(files: string[], folderPath: string): string[] {
  const prefix = folderPath ? `${toPosixPath(folderPath)}/` : '';
  if (!prefix) return files;
  return files.filter((file) => file.startsWith(prefix));
}
