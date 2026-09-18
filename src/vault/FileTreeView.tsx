import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, IconButton, Text } from '@radix-ui/themes';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  FileIcon,
  FileTextIcon,
  ArchiveIcon,
} from '@radix-ui/react-icons';
import { buildFileTree, isPdfFileName, isQuizFileName, noteTitle } from './fileTree';
import type { VaultFolderNode, VaultTreeNode } from './types';

export type TreeItemKind = 'file' | 'folder';

/** Paths flagged "New" (e.g. freshly generated, not yet opened). */
const NewPathsContext = createContext<ReadonlySet<string>>(new Set());

type FileTreeViewProps = {
  files: string[];
  folders?: string[];
  selected: string;
  /** Currently targeted folder for new notes/folders (`''` = vault root). */
  activeFolder: string;
  /** @deprecated Unused — vault root label row was removed for a minimal sidebar. */
  vaultLabel?: string;
  filterPaths?: string[] | null;
  /** Files to badge as new until the user opens them. */
  newPaths?: string[];
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRename: (path: string, kind: TreeItemKind, nextName: string) => void | Promise<void>;
  onDelete: (path: string, kind: TreeItemKind) => void | Promise<void>;
};

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const committed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const finish = (next: string | null) => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = next?.trim() ?? '';
    if (!trimmed || trimmed === initialValue) onCancel();
    else onCommit(trimmed);
  };

  return (
    <input
      ref={ref}
      className="tree-rename-input"
      value={value}
      aria-label="Rename"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}

function FolderBranch({
  node,
  depth,
  selected,
  activeFolder,
  expanded,
  renaming,
  onToggle,
  onSelectFile,
  onSelectFolder,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  node: VaultFolderNode;
  depth: number;
  selected: string;
  activeFolder: string;
  expanded: Set<string>;
  renaming: { path: string; kind: TreeItemKind } | null;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onStartRename: (path: string, kind: TreeItemKind) => void;
  onCommitRename: (path: string, kind: TreeItemKind, nextName: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string, kind: TreeItemKind) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = activeFolder === node.path;
  const isRenaming = renaming?.kind === 'folder' && renaming.path === node.path;
  const newPathSet = useContext(NewPathsContext);
  const hasNewInside =
    !isOpen && [...newPathSet].some((path) => path.startsWith(`${node.path}/`));

  return (
    <div className="tree-branch">
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <div
            className={`folder-row ${isActive ? 'active-folder' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            tabIndex={0}
            role="treeitem"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('text/plain')) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const source = event.dataTransfer.getData('text/plain');
              if (source) onCommitRename(source, 'file', `${node.path}/${source.split('/').pop()}`);
            }}
            aria-selected={isActive}
            onClick={() => {
              // The whole folder row is a disclosure control; keep selecting
              // the folder as the target for new notes while toggling it.
              onSelectFolder(node.path);
              onToggle(node.path);
            }}
            onKeyDown={(event) => {
              if (isRenaming) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                onSelectFolder(node.path);
                onStartRename(node.path, 'folder');
              } else if (event.key === 'F2') {
                event.preventDefault();
                onSelectFolder(node.path);
                onStartRename(node.path, 'folder');
              }
            }}
          >
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              highContrast
              aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.path);
              }}
            >
              {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </IconButton>
            <div className="folder-select">
              <ArchiveIcon width={15} height={15} />
              {isRenaming ? (
                <InlineRenameInput
                  initialValue={node.name}
                  onCommit={(next) => onCommitRename(node.path, 'folder', next)}
                  onCancel={onCancelRename}
                />
              ) : (
                <Text size="2" as="span">
                  {node.name}
                </Text>
              )}
              {hasNewInside ? <span className="new-dot" aria-label="Contains a new quiz" /> : null}
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Content size="1" variant="soft">
          <ContextMenu.Item
            onSelect={() => {
              onSelectFolder(node.path);
              requestAnimationFrame(() => onStartRename(node.path, 'folder'));
            }}
          >
            Rename
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            color="red"
            onSelect={() => void onDelete(node.path, 'folder')}
          >
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>      </ContextMenu.Root>
      {isOpen
        ? node.children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              selected={selected}
              activeFolder={activeFolder}
              expanded={expanded}
              renaming={renaming}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              onSelectFolder={onSelectFolder}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
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
  renaming,
  onToggle,
  onSelectFile,
  onSelectFolder,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  node: VaultTreeNode;
  depth: number;
  selected: string;
  activeFolder: string;
  expanded: Set<string>;
  renaming: { path: string; kind: TreeItemKind } | null;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onStartRename: (path: string, kind: TreeItemKind) => void;
  onCommitRename: (path: string, kind: TreeItemKind, nextName: string) => void;
  onCancelRename: () => void;
  onDelete: (path: string, kind: TreeItemKind) => void;
}) {
  if (node.type === 'folder') {
    return (
      <FolderBranch
        node={node}
        depth={depth}
        selected={selected}
        activeFolder={activeFolder}
        expanded={expanded}
        renaming={renaming}
        onToggle={onToggle}
        onSelectFile={onSelectFile}
        onSelectFolder={onSelectFolder}
        onStartRename={onStartRename}
        onCommitRename={onCommitRename}
        onCancelRename={onCancelRename}
        onDelete={onDelete}
      />
    );
  }

  const isSelected = selected === node.path;
  const isQuiz = isQuizFileName(node.name);
  const isPdf = isPdfFileName(node.name);
  const isRenaming = renaming?.kind === 'file' && renaming.path === node.path;
  const label = noteTitle(node.path);
  const isNew = useContext(NewPathsContext).has(node.path);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <button
          type="button"
          className={`file-row ${isSelected ? 'selected' : ''} ${isQuiz ? 'quiz-file' : ''} ${isPdf ? 'pdf-file' : ''}`}
          draggable={!isRenaming}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', node.path);
            event.dataTransfer.effectAllowed = 'move';
          }}
          style={{ paddingLeft: 28 + depth * 14 }}
          onClick={() => onSelectFile(node.path)}
          onKeyDown={(event) => {
            if (isRenaming) return;
            if (event.key === 'Enter' || event.key === 'F2') {
              event.preventDefault();
              onSelectFile(node.path);
              onStartRename(node.path, 'file');
            }
          }}
        >
          {isQuiz ? (
            <ClipboardIcon width={14} height={14} className="quiz-file-icon" />
          ) : isPdf ? (
            <FileIcon width={14} height={14} className="pdf-file-icon" />
          ) : (
            <FileTextIcon width={14} height={14} />
          )}
          {isRenaming ? (
            <InlineRenameInput
              initialValue={label}
              onCommit={(next) => onCommitRename(node.path, 'file', next)}
              onCancel={onCancelRename}
            />
          ) : (
            <Text size="2" as="span" className="file-row-label">
              {label}
            </Text>
          )}
          {isNew ? <span className="new-badge">New</span> : null}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Content size="1" variant="soft">
        <ContextMenu.Item
          onSelect={() => {
            onSelectFile(node.path);
            requestAnimationFrame(() => onStartRename(node.path, 'file'));
          }}
        >
          Rename
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          color="red"
          onSelect={() => void onDelete(node.path, 'file')}
        >
          Delete
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
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
  filterPaths = null,
  newPaths,
  onSelectFile,
  onSelectFolder,
  onRename,
  onDelete,
}: FileTreeViewProps) {
  const tree = useMemo(() => {
    const full = buildFileTree(files, folders);
    if (!filterPaths) return full;
    return filterTree(full, new Set(filterPaths));
  }, [files, folders, filterPaths]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<{ path: string; kind: TreeItemKind } | null>(
    null,
  );
  const prevFoldersRef = useRef(folders);

  useEffect(() => {
    const prev = new Set(prevFoldersRef.current);
    const added = folders.filter((path) => !prev.has(path));
    prevFoldersRef.current = folders;
    // Initial vault load (nothing listed before) stays collapsed; only folders
    // created afterwards auto-open.
    if (prev.size === 0 || added.length === 0) return;
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

  const newPathSet = useMemo(() => new Set(newPaths ?? []), [newPaths]);

  // Reveal items that become new while running, so the badge is visible. Ones
  // already new at launch stay collapsed (folders start closed).
  const seenNewRef = useRef(newPathSet);
  useEffect(() => {
    const fresh = [...newPathSet].filter((path) => !seenNewRef.current.has(path));
    seenNewRef.current = newPathSet;
    if (fresh.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of fresh) {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i += 1) next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }, [newPathSet]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const commitRename = (path: string, kind: TreeItemKind, nextName: string) => {
    setRenaming(null);
    void onRename(path, kind, nextName);
  };

  return (
    <div
      className="file-tree"
      role="tree"
      onClick={(event) => {
        // Empty sidebar / tree chrome → create target is vault root.
        if (event.target === event.currentTarget) onSelectFolder('');
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('text/plain')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData('text/plain');
        if (source) commitRename(source, 'file', `@root/${source.split('/').pop() ?? source}`);
      }}
    >
      <NewPathsContext.Provider value={newPathSet}>
        {tree.children.map((child) => (
          <TreeNode
            key={`${child.type}:${child.path}`}
            node={child}
            depth={0}
            selected={selected}
            activeFolder={activeFolder}
            expanded={expanded}
            renaming={renaming}
            onToggle={toggle}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
            onStartRename={(path, kind) => setRenaming({ path, kind })}
            onCommitRename={commitRename}
            onCancelRename={() => setRenaming(null)}
            onDelete={onDelete}
          />
        ))}
      </NewPathsContext.Provider>
    </div>
  );
}
