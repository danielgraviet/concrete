import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { buildFileTree, isQuizFileName } from './fileTree';
import type { VaultFolderNode, VaultTreeNode } from './types';

type FileTreeViewProps = {
  files: string[];
  folders?: string[];
  selected: string;
  /** Currently targeted folder for new notes (`''` = vault root). */
  activeFolder: string;
  vaultLabel: string;
  filterPaths?: string[] | null;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRenameFile?: (path: string) => void;
};

function FolderBranch({
  node,
  depth,
  selected,
  activeFolder,
  expanded,
  onToggle,
  onSelectFile,
  onSelectFolder,
  onRenameFile,
}: {
  node: VaultFolderNode;
  depth: number;
  selected: string;
  activeFolder: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRenameFile?: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = activeFolder === node.path;

  return (
    <div className="tree-branch">
      <div
        className={`folder-row ${isActive ? 'active-folder' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="folder-chevron"
          aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
          onClick={() => onToggle(node.path)}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="folder-select"
          onClick={() => onSelectFolder(node.path)}
        >
          {isOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{node.name}</span>
        </button>
      </div>
      {isOpen
        ? node.children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              selected={selected}
              activeFolder={activeFolder}
              expanded={expanded}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              onSelectFolder={onSelectFolder}
              onRenameFile={onRenameFile}
            />
          ))
        : null}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  activeFolder,
  expanded,
  onToggle,
  onSelectFile,
  onSelectFolder,
  onRenameFile,
}: {
  node: VaultTreeNode;
  depth: number;
  selected: string;
  activeFolder: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRenameFile?: (path: string) => void;
}) {
  if (node.type === 'folder') {
    return (
      <FolderBranch
        node={node}
        depth={depth}
        selected={selected}
        activeFolder={activeFolder}
        expanded={expanded}
        onToggle={onToggle}
        onSelectFile={onSelectFile}
        onSelectFolder={onSelectFolder}
        onRenameFile={onRenameFile}
      />
    );
  }

  return (
    <button
      type="button"
      className={`file-row ${selected === node.path ? 'selected' : ''} ${isQuizFileName(node.name) ? 'quiz-file' : ''}`}
      style={{ paddingLeft: 28 + depth * 14 }}
      onClick={() => onSelectFile(node.path)}
      onDoubleClick={() => onRenameFile?.(node.path)}
    >
      {isQuizFileName(node.name) ? (
        <ClipboardList size={14} className="quiz-file-icon" />
      ) : (
        <FileText size={14} />
      )}
      <span>{node.name.replace(/\.md$/i, '')}</span>
    </button>
  );
}

function filterTree(node: VaultFolderNode, allowed: Set<string>): VaultFolderNode {
  const children: VaultTreeNode[] = [];
  for (const child of node.children) {
    if (child.type === 'file') {
      if (allowed.has(child.path)) children.push(child);
      continue;
    }
    const next = filterTree(child, allowed);
    const hasAllowedDescendant = next.children.length > 0;
    if (hasAllowedDescendant) children.push(next);
  }
  return { ...node, children };
}

export function FileTreeView({
  files,
  folders = [],
  selected,
  activeFolder,
  vaultLabel,
  filterPaths = null,
  onSelectFile,
  onSelectFolder,
  onRenameFile,
}: FileTreeViewProps) {
  const tree = useMemo(() => {
    const full = buildFileTree(files, folders);
    if (!filterPaths) return full;
    return filterTree(full, new Set(filterPaths));
  }, [files, folders, filterPaths]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders));
  const prevFoldersRef = useRef(folders);

  useEffect(() => {
    const prev = new Set(prevFoldersRef.current);
    const added = folders.filter((path) => !prev.has(path));
    prevFoldersRef.current = folders;
    if (added.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of added) next.add(path);
      return next;
    });
  }, [folders]);

  useEffect(() => {
    if (!activeFolder) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = activeFolder.split('/');
      for (let i = 1; i <= parts.length; i += 1) {
        next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }, [activeFolder]);

  useEffect(() => {
    if (!selected.includes('/')) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = selected.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }, [selected]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="file-tree">
      <button
        type="button"
        className={`folder-row root-folder ${activeFolder === '' ? 'active-folder' : ''}`}
        onClick={() => onSelectFolder('')}
      >
        <FolderOpen size={15} />
        <span>{vaultLabel}</span>
      </button>
      {tree.children.map((child) => (
        <TreeNode
          key={`${child.type}:${child.path}`}
          node={child}
          depth={0}
          selected={selected}
          activeFolder={activeFolder}
          expanded={expanded}
          onToggle={toggle}
          onSelectFile={onSelectFile}
          onSelectFolder={onSelectFolder}
          onRenameFile={onRenameFile}
        />
      ))}
    </div>
  );
}
