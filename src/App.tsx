import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { WysiwygEditor, useEditorController } from './editor';
import {
  askText,
  canMkdir,
  canUseDiskVault,
  ensureFolderAncestors,
  FileTreeView,
  joinNotePath,
  parentDir,
  useVault,
  VaultService,
} from './vault';
import { useBacklinks } from './graph';
import { useSearch } from './search';
import { MetaService } from './meta';
import {
  CardStore,
  ReviewPanel,
  QuizView,
  ReviewQueue,
  Sm2SchedulerStrategy,
  type Flashcard,
} from './learn';
import {
  aiClient,
  AiOrb,
  LocalEchoProvider,
  MockAiProvider,
  setSlashAiHandler,
  truncateNoteContext,
} from './ai';
import { settingsStore, SettingsPanel } from './settings';

const demoNotes = [
  'Welcome.md',
  'Projects.md',
  'Ideas.md',
  'Stats/Overview.md',
  'Machine Learning/Notes.md',
];
const demoFolders = ['Stats', 'Machine Learning'];
const demoContent: Record<string, string> = {
  'Welcome.md':
    '# Welcome to your vault\n\nA fast, local-first home for your thinking.\n\n## Start here\n\n- Open a folder to work with real Markdown files\n- Create **folders** to organize topics (Stats, Machine Learning, …)\n- Create notes inside those folders\n- Link notes with [[Projects]] and [[Ideas]]\n\n#mvp #vault\n\n> The best knowledge system is the one that gets out of your way.',
  'Projects.md':
    '# Projects\n\nA place for active work.\n\nSee also [[Welcome]].\n\n- [ ] Build the review queue\n- [ ] Add backlinks\n- [ ] Design the quiz experience\n\n#mvp',
  'Ideas.md': '# Ideas\n\nCapture quickly. Organize later.\n\nBack to [[Welcome]].\n',
  'Stats/Overview.md':
    '# Stats\n\nNotes living under the **Stats** folder.\n\nCreate more `.md` files here to keep metrics and analysis together.\n',
  'Machine Learning/Notes.md':
    '# Machine Learning\n\nA topic folder for ML notes, papers, and experiments.\n',
};

type RailView = 'files' | 'tags' | 'ai';
type Overlay = 'settings' | null;

const LAYOUT_KEY = 'mv:layout';

type LayoutState = {
  sidebarOpen: boolean;
  rightOpen: boolean;
  focusMode: boolean;
};

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { sidebarOpen: true, rightOpen: false, focusMode: false };
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      sidebarOpen: parsed.sidebarOpen !== false,
      // Right panel (backlinks + review) starts collapsed unless user opened it
      rightOpen: parsed.rightOpen === true,
      focusMode: false,
    };
  } catch {
    return { sidebarOpen: true, rightOpen: false, focusMode: false };
  }
}

function resolveAiProvider(id: string) {
  return id === 'local-echo' ? new LocalEchoProvider() : new MockAiProvider();
}

export default function App() {
  const vault = useVault(demoNotes, demoFolders);
  const [selected, setSelected] = useState('Welcome.md');
  const [activeFolder, setActiveFolder] = useState('');
  const [contents, setContents] = useState<Record<string, string>>({ ...demoContent });
  const [query, setQuery] = useState('');
  const [rail, setRail] = useState<RailView>('files');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiSeedPrompt, setAiSeedPrompt] = useState<string | null>(null);
  const [quizCards, setQuizCards] = useState<Flashcard[] | null>(null);
  const [dueTick, setDueTick] = useState(0);
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());

  const openAiChat = (seed?: string) => {
    if (seed?.trim()) setAiSeedPrompt(seed.trim());
    setAiChatOpen(true);
  };

  const setSidebarOpen = (sidebarOpen: boolean) =>
    setLayout((current) => ({ ...current, sidebarOpen, focusMode: false }));
  const setRightOpen = (rightOpen: boolean) =>
    setLayout((current) => ({ ...current, rightOpen, focusMode: false }));
  const toggleFocusMode = () =>
    setLayout((current) => ({ ...current, focusMode: !current.focusMode }));

  useEffect(() => {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        sidebarOpen: layout.sidebarOpen,
        rightOpen: layout.rightOpen,
      }),
    );
  }, [layout.sidebarOpen, layout.rightOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (event.key === 'Escape' && layout.focusMode) {
        event.preventDefault();
        setLayout((current) => ({ ...current, focusMode: false }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout.focusMode]);

  const selectRail = (next: RailView) => {
    if (next === 'ai') {
      openAiChat();
      setRail('ai');
      return;
    }
    if (layout.focusMode) {
      setLayout((current) => ({ ...current, focusMode: false, sidebarOpen: true }));
      setRail(next);
      return;
    }
    if (rail === next && layout.sidebarOpen) {
      setSidebarOpen(false);
      return;
    }
    setRail(next);
    setSidebarOpen(true);
  };

  const root = vault.root;
  const files = vault.files;

  const cardStore = useMemo(() => new CardStore(root ?? ''), [root]);
  const reviewQueue = useMemo(
    () => new ReviewQueue(cardStore, new Sm2SchedulerStrategy()),
    [cardStore],
  );

  useEffect(() => {
    const settings = settingsStore.hydrate();
    aiClient.setProvider(resolveAiProvider(settings.providerId));
    return settingsStore.subscribe((next) => {
      aiClient.setProvider(resolveAiProvider(next.providerId));
    });
  }, []);

  useEffect(() => {
    setSlashAiHandler((query) => openAiChat(query));
    return () => setSlashAiHandler(null);
  }, []);

  useEffect(() => {
    cardStore.setVaultRoot(root ?? '');
    void cardStore.load().then(() => setDueTick((n) => n + 1));
    return cardStore.subscribe(() => setDueTick((n) => n + 1));
  }, [cardStore, root]);

  const rootRef = useRef(root);
  const selectedRef = useRef(selected);
  const contentRef = useRef('');
  const markSavedRef = useRef<(content?: string) => void>(() => {});
  rootRef.current = root;
  selectedRef.current = selected;

  const controller = useEditorController({
    initialContent: contents[selected] ?? '',
    autosaveMs: settingsStore.get().autosaveMs || 800,
    saveFn: async () => {
      const path = selectedRef.current;
      const vaultRoot = rootRef.current;
      const markdown = contentRef.current;
      if (vaultRoot && path) {
        await VaultService.write(vaultRoot, path, markdown);
      }
      setContents((prev) => ({ ...prev, [path]: markdown }));
      markSavedRef.current(markdown);
    },
  });

  contentRef.current = controller.content;
  markSavedRef.current = controller.markSaved;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selected) {
        controller.loadContent('');
        return;
      }
      if (root) {
        try {
          const text = await VaultService.read(root, selected);
          if (cancelled) return;
          setContents((prev) => ({ ...prev, [selected]: text }));
          controller.loadContent(text);
          return;
        } catch {
          /* fall through to cache */
        }
      }
      const fallback = contents[selected] ?? demoContent[selected] ?? '';
      controller.loadContent(fallback);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on note/vault change
  }, [root, selected]);

  // External file changes for the open note
  useEffect(() => {
    if (!root) return;
    return VaultService.onWatch((event) => {
      if (event.root !== root || event.type !== 'change' || event.path !== selected) return;
      void VaultService.read(root, event.path).then((text) => {
        setContents((prev) => ({ ...prev, [event.path]: text }));
        if (!controller.isDirty) controller.loadContent(text);
      });
    });
  }, [root, selected, controller]);

  const notes = useMemo(
    () =>
      files.map((path) => ({
        path,
        content:
          path === selected
            ? controller.content
            : (contents[path] ?? demoContent[path] ?? ''),
      })),
    [files, selected, controller.content, contents],
  );

  // Warm index: load missing note bodies when vault opens
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        files.map(async (path) => {
          try {
            return [path, await VaultService.read(root, path)] as const;
          } catch {
            return [path, ''] as const;
          }
        }),
      );
      if (cancelled) return;
      setContents((prev) => {
        const next = { ...prev };
        for (const [path, text] of entries) {
          if (path === selectedRef.current && contentRef.current) {
            next[path] = contentRef.current;
          } else {
            next[path] = text;
          }
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [root, files]);

  const { backlinks } = useBacklinks(selected, notes);
  const { results: searchResults } = useSearch(query, notes);
  const meta = useMemo(() => new MetaService().build(notes), [notes]);
  const allTags = meta.getTags();
  const noteTags = selected ? meta.getTags(selected) : [];

  const filterPaths = (() => {
    const tagMatch = query.trim().match(/^#(\S+)$/);
    if (tagMatch) return meta.getNotesWithTag(tagMatch[1]);
    if (query.trim()) return searchResults.map((r) => r.path);
    return null;
  })();

  const openVault = async () => {
    const result = await vault.open();
    if (!result) return;
    setContents({});
    setActiveFolder('');
    const first = result.files[0] ?? '';
    setSelected(first);
  };

  const select = (name: string) => {
    if (controller.isDirty) void controller.persistence.flush();
    setSelected(name);
    setActiveFolder(parentDir(name));
  };

  const finishNewNote = (relative: string) => {
    const title = relative.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled';
    const body = `# ${title}\n\n`;
    setContents((prev) => ({ ...prev, [relative]: body }));
    setSelected(relative);
    setActiveFolder(parentDir(relative));
    controller.loadContent(body);
  };

  const createDemoNote = (relative: string) => {
    vault.setFiles((current) =>
      current.includes(relative)
        ? current
        : [...current, relative].sort((a, b) => a.localeCompare(b)),
    );
    const parent = parentDir(relative);
    if (parent) {
      vault.setFolders((current) => ensureFolderAncestors(current, parent));
    }
    finishNewNote(relative);
  };

  const create = async () => {
    const name = await askText(
      activeFolder ? `New note in ${activeFolder}` : 'New note name',
    );
    if (!name) return;
    const relative = joinNotePath(activeFolder, name);
    if (!relative) return;

    if (canUseDiskVault(root)) {
      try {
        const created = await vault.create(relative);
        finishNewNote(created);
        return;
      } catch (error) {
        console.error('Failed to create note on disk', error);
        return;
      }
    }

    createDemoNote(relative);
  };

  const createFolder = async () => {
    const name = await askText(
      activeFolder ? `New folder inside ${activeFolder}` : 'New folder name',
    );
    if (!name) return;
    const cleaned = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleaned || cleaned.split('/').some((part) => part === '..' || !part)) {
      return;
    }
    const relative = activeFolder ? `${activeFolder}/${cleaned}` : cleaned;

    if (canUseDiskVault(root) && canMkdir()) {
      try {
        const created = await vault.mkdir(relative);
        setActiveFolder(created);
        return;
      } catch (error) {
        console.error('Failed to create folder on disk', error);
        return;
      }
    }

    // Demo mode, or Electron without mkdir IPC yet — keep the tree usable.
    vault.setFolders((current) => ensureFolderAncestors(current, relative));
    setActiveFolder(relative);
  };

  const renameSelected = async () => {
    if (!selected) return;
    const currentName = selected.split('/').pop()?.replace(/\.md$/i, '') ?? selected;
    const next = window.prompt('Rename note', currentName);
    if (!next) return;
    const folder = parentDir(selected);
    const target = joinNotePath(folder, next);
    if (root) {
      const renamed = await vault.rename(selected, target);
      setContents((prev) => {
        const copy = { ...prev };
        copy[renamed] = copy[selected] ?? controller.content;
        delete copy[selected];
        return copy;
      });
      setSelected(renamed);
      setActiveFolder(parentDir(renamed));
    } else {
      vault.setFiles((current) =>
        current.map((f) => (f === selected ? target : f)).sort(),
      );
      setContents((prev) => {
        const copy = { ...prev };
        copy[target] = copy[selected] ?? controller.content;
        delete copy[selected];
        return copy;
      });
      setSelected(target);
      setActiveFolder(parentDir(target));
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected}?`)) return;
    if (root) await vault.delete(selected);
    else vault.setFiles((current) => current.filter((f) => f !== selected));
    setContents((prev) => {
      const copy = { ...prev };
      delete copy[selected];
      return copy;
    });
    const remaining = files.filter((f) => f !== selected);
    setSelected(remaining[0] ?? '');
  };

  const saved = !controller.isDirty;
  const vaultLabel = root ? root.split('/').pop() : 'Starter vault';
  const shellClass = [
    'app-shell',
    layout.focusMode ? 'focus-mode' : '',
    !layout.focusMode && !layout.sidebarOpen ? 'sidebar-collapsed' : '',
    !layout.focusMode && !layout.rightOpen ? 'right-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <header className="topbar">
        <div className="brand">
          <BookOpen size={17} />
          <span>Markdown Vault</span>
        </div>
        <div className="vault-name">
          {vaultLabel} <ChevronDown size={14} />
        </div>
      </header>

      <aside className="rail" aria-label="Primary">
        <button
          type="button"
          className={`rail-button ${rail === 'files' && layout.sidebarOpen && !layout.focusMode ? 'active' : ''}`}
          title="Files"
          onClick={() => selectRail('files')}
        >
          <FileText size={19} />
        </button>
        <button
          type="button"
          className={`rail-button ${rail === 'tags' && layout.sidebarOpen && !layout.focusMode ? 'active' : ''}`}
          title="Tags"
          onClick={() => selectRail('tags')}
        >
          <Hash size={19} />
        </button>
        <button
          type="button"
          className={`rail-button ${rail === 'ai' || aiChatOpen ? 'active' : ''}`}
          title="Tutor"
          onClick={() => selectRail('ai')}
        >
          <Sparkles size={19} />
        </button>
        <div className="rail-spacer" />
        <button
          type="button"
          className={`rail-button ${layout.focusMode ? 'active' : ''}`}
          title={layout.focusMode ? 'Exit focus mode' : 'Focus mode'}
          onClick={toggleFocusMode}
        >
          {layout.focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button
          type="button"
          className="rail-button"
          title="Settings"
          onClick={() => setOverlay('settings')}
        >
          <Settings size={19} />
        </button>
      </aside>

      <aside className="sidebar" aria-hidden={!layout.sidebarOpen || layout.focusMode}>
        {rail === 'tags' ? (
          <>
            <div className="sidebar-heading">
              <span>TAGS</span>
              <button type="button" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}>
                <PanelLeftClose size={15} />
              </button>
            </div>
            <div className="file-tree tag-list">
              {allTags.length === 0 ? (
                <div className="empty-inline">No tags yet</div>
              ) : (
                allTags.map((tag) => (
                  <button
                    type="button"
                    className="file-row"
                    key={tag}
                    onClick={() => setQuery(`#${tag}`)}
                  >
                    <Hash size={14} />
                    <span>{tag}</span>
                    <small className="tag-count">{meta.getNotesWithTag(tag).length}</small>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-heading">
              <span>FILE EXPLORER</span>
              <div className="sidebar-heading-actions">
                <button type="button" title="New folder" onClick={createFolder}>
                  <FolderPlus size={16} />
                </button>
                <button
                  type="button"
                  title={activeFolder ? `New note in ${activeFolder}` : 'New note'}
                  onClick={create}
                >
                  <Plus size={16} />
                </button>
                <button type="button" title="Delete note" onClick={deleteSelected}>
                  <Trash2 size={15} />
                </button>
                <button type="button" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}>
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>
            <button type="button" className="open-vault" onClick={openVault}>
              <FolderOpen size={15} /> {root ? 'Change vault' : 'Open a vault'}
            </button>
            {activeFolder ? (
              <div className="active-folder-chip">
                <Folder size={13} />
                <span>{activeFolder}</span>
                <button type="button" onClick={() => setActiveFolder('')} title="Clear folder target">
                  ×
                </button>
              </div>
            ) : null}
            <div className="search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes..."
              />
            </div>
            <FileTreeView
              files={files}
              folders={vault.folders}
              selected={selected}
              activeFolder={activeFolder}
              vaultLabel={vaultLabel ?? 'Vault'}
              filterPaths={filterPaths}
              onSelectFile={select}
              onSelectFolder={setActiveFolder}
              onRenameFile={() => void renameSelected()}
            />
          </>
        )}
        <div className="sidebar-footer">
          <span className={`sync-dot ${saved ? '' : 'unsaved'}`} />
          {saved ? 'All changes saved' : 'Unsaved changes'}
        </div>
      </aside>

      <main className="editor">
        <div className="tabs">
          {!layout.focusMode && (
            <button
              type="button"
              className="pane-toggle"
              title={layout.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              onClick={() => setSidebarOpen(!layout.sidebarOpen)}
            >
              {layout.sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
          )}
          <div className="tab active" title={selected}>
            <FileText size={14} />
            {(selected.split('/').pop() ?? selected).replace(/\.md$/i, '') || 'Untitled'}{' '}
            {!saved && <span className="dirty">•</span>}
          </div>
          <div className="tab-spacer" />
          {noteTags.length > 0 && (
            <div className="note-tags">
              {noteTags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
          <button
            type="button"
            className={`pane-toggle ${layout.focusMode ? 'active' : ''}`}
            title={layout.focusMode ? 'Exit focus mode (Esc)' : 'Focus mode (⌘⇧F)'}
            onClick={toggleFocusMode}
          >
            {layout.focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          {!layout.focusMode && (
            <button
              type="button"
              className="pane-toggle"
              title={layout.rightOpen ? 'Hide right panel' : 'Show right panel'}
              onClick={() => setRightOpen(!layout.rightOpen)}
            >
              {layout.rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          )}
          <span className="mode-label">Markdown</span>
        </div>
        <div className="editor-wrap">
          <WysiwygEditor
            className="wysiwyg"
            markdown={controller.content}
            onChange={(value) => {
              controller.setContent(value);
              setContents((prev) => ({ ...prev, [selected]: value }));
            }}
            onBlur={() => void controller.persistence.flush()}
          />
        </div>
        <AiOrb
          client={aiClient}
          noteContext={truncateNoteContext(controller.content)}
          open={aiChatOpen}
          onOpenChange={setAiChatOpen}
          seedPrompt={aiSeedPrompt}
          onSeedConsumed={() => setAiSeedPrompt(null)}
        />
        <footer className="statusbar">
          <span>{controller.content.length} characters</span>
          <span>•</span>
          <span>{root ? 'Local vault' : 'Demo vault'}</span>
          <span className="status-spacer" />
          {layout.focusMode ? <span>Focus mode · Esc to exit</span> : <span>{saved ? 'Saved' : 'Editing'}</span>}
        </footer>
      </main>

      <aside className="right-panel" aria-hidden={!layout.rightOpen || layout.focusMode}>
        <div className="panel-title-row">
          <div className="panel-title">BACKLINKS</div>
          <button type="button" className="pane-toggle" title="Collapse panel" onClick={() => setRightOpen(false)}>
            <PanelRightClose size={15} />
          </button>
        </div>
        {backlinks.length === 0 ? (
          <div className="empty-panel">
            <Hash size={18} />
            <span>No backlinks yet</span>
            <small>Links to this note will appear here.</small>
          </div>
        ) : (
          <div className="backlink-list">
            {backlinks.map((hit) => (
              <button
                type="button"
                className="backlink-row"
                key={hit.path}
                onClick={() => select(hit.path)}
              >
                <FileText size={14} />
                <span>{hit.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="panel-section">
          <ReviewPanel
            store={cardStore}
            queue={reviewQueue}
            onStartQuiz={(cards) => setQuizCards(cards)}
          />
          <span className="sr-only">{dueTick}</span>
        </div>
      </aside>

      {layout.focusMode && (
        <button type="button" className="focus-exit" onClick={toggleFocusMode} title="Exit focus mode">
          <Minimize2 size={14} /> Exit focus
        </button>
      )}

      {overlay === 'settings' && (
        <div className="mv-overlay" role="dialog">
          <SettingsPanel store={settingsStore} onClose={() => setOverlay(null)} />
        </div>
      )}
      {quizCards && (
        <div className="mv-overlay mv-overlay-quiz" role="dialog">
          <QuizView
            cards={quizCards}
            queue={reviewQueue}
            onClose={() => setQuizCards(null)}
          />
        </div>
      )}
    </div>
  );
}
