import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, IconButton, Text } from '@radix-ui/themes';
import {
  ClipboardIcon,
  Cross1Icon,
  FilePlusIcon,
  FileTextIcon,
  GearIcon,
  BadgeIcon,
  PlusCircledIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Bot,
  Expand,
  Loader2,
  Minimize2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { WysiwygEditor, useEditorController } from './editor';
import {
  askText,
  canMkdir,
  canUseDiskVault,
  ensureFolderAncestors,
  FileTreeView,
  isPdfFileName,
  joinFolderPath,
  joinNotePath,
  joinPdfPath,
  noteTitle,
  parentDir,
  useVault,
  VaultService,
  type TreeItemKind,
} from './vault';
import { useBacklinks } from './graph';

const MAX_TAB_TITLE_CHARS = 32;

function tabTitleFor(path: string): string {
  const title = (path.split('/').pop() ?? path).replace(/\.md$/i, '') || 'Untitled';
  return title.length > MAX_TAB_TITLE_CHARS
    ? `${title.slice(0, MAX_TAB_TITLE_CHARS - 1)}…`
    : title;
}
import { useSearch } from './search';
import { MetaService } from './meta';
import {
  CardStore,
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
  OpenRouterProvider,
  setSlashAiHandler,
  truncateNoteContext,
} from './ai';
import {
  isQuizPath,
  quizDocumentToMarkdown,
  QuizShell,
  GenerateQuizDialog,
  type GenerateQuizDialogResult,
  ProgressPanel,
} from './quiz';
import { QuizHistoryStore } from './quiz';
import { settingsStore, SettingsPanel } from './settings';
import { getSandboxStatus } from './sandbox';
import { verifyCodeQuestions } from './quiz/verifyCode';
import type { AgentProviderId } from './settings';
import { ProductTour } from './onboarding';


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
    '# Welcome to your vault\n\nA fast, local-first home for your thinking.\n\n## Start here\n\n- Open a folder to work with real Markdown files\n- Create **folders** to organize topics (Stats, Machine Learning, …)\n- Create notes inside those folders\n- Link notes with [[Projects]] and [[Ideas]]\n\n> The best knowledge system is the one that gets out of your way.',
  'Projects.md':
    '# Projects\n\nA place for active work.\n\nSee also [[Welcome]].\n\n- [ ] Build the review queue\n- [ ] Add backlinks\n- [ ] Design the quiz experience\n',
  'Ideas.md': '# Ideas\n\nCapture quickly. Organize later.\n\nBack to [[Welcome]].\n',
  'Stats/Overview.md':
    '# Stats\n\nNotes living under the **Stats** folder.\n\nCreate more `.md` files here to keep metrics and analysis together.\n',
  'Machine Learning/Notes.md':
    '# Machine Learning\n\nA topic folder for ML notes, papers, and experiments.\n',
};

type RailView = 'files' | 'tags' | 'ai';
type Overlay = 'settings' | null;

const LAYOUT_KEY = 'mv:layout';
const LAST_NOTE_KEY = 'mv:last-note';
const NEW_QUIZZES_KEY = 'mv:new-quizzes';

function readNewQuizzes(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NEW_QUIZZES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function readLastNote(): string {
  try {
    return localStorage.getItem(LAST_NOTE_KEY) ?? '';
  } catch {
    return '';
  }
}

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

function resolveAiProvider(id: string, openRouterModelId?: string) {
  if (id === 'openrouter') {
    return new OpenRouterProvider(openRouterModelId);
  }
  if (id === 'local-echo') return new LocalEchoProvider();
  return new MockAiProvider();
}

export default function App() {
  const vault = useVault(demoNotes, demoFolders);
  const [selected, setSelected] = useState('Welcome.md');
  // Only remember the open note once the restored/initial selection is settled,
  // so the placeholder default never overwrites the saved one.
  const persistSelectionRef = useRef(false);
  // Generated quizzes the user hasn't opened yet; badged "New" in the tree.
  const [newQuizPaths, setNewQuizPaths] = useState<string[]>(readNewQuizzes);
  const [onboarding, setOnboarding] = useState(
    () => typeof window !== 'undefined' && Boolean(window.vault) && !localStorage.getItem('mv:onboarding-complete'),
  );
  /** 'welcome' = vault picker; 'tour' = product advantages walkthrough */
  const [onboardingMode, setOnboardingMode] = useState<'welcome' | 'tour'>('welcome');
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [activeFolder, setActiveFolder] = useState('');
  const [treeFocus, setTreeFocus] = useState<{
    kind: TreeItemKind;
    path: string;
  } | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({ ...demoContent });
  const [query, setQuery] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findInputRef = useRef<HTMLInputElement>(null);
  const [rail, setRail] = useState<RailView>('files');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiSeedPrompt, setAiSeedPrompt] = useState<string | null>(null);
  const [quizCards, setQuizCards] = useState<Flashcard[] | null>(null);
  const [dueTick, setDueTick] = useState(0);
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());
  const [generateQuizOpen, setGenerateQuizOpen] = useState(false);
  const [quizJob, setQuizJob] = useState<
    | { status: 'idle' }
    | { status: 'running'; title: string }
    | { status: 'done'; title: string; path: string; note?: string }
    | { status: 'error'; title: string; message: string }
  >({ status: 'idle' });
  const generatingQuiz = quizJob.status === 'running';
  const quizJobRef = useRef(0);
  const [agentProviderId, setAgentProviderId] = useState<AgentProviderId>(
    () => settingsStore.get().agentProviderId,
  );
  const [editorRevision, setEditorRevision] = useState(0);

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
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (event.key === 'Escape') {
        if (overlay === 'settings') {
          event.preventDefault();
          setOverlay(null);
          return;
        }
        if (layout.focusMode) {
          event.preventDefault();
          setLayout((current) => ({ ...current, focusMode: false }));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout.focusMode, overlay]);

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
  const pdfFiles = vault.pdfFiles;

  const cardStore = useMemo(() => new CardStore(root ?? ''), [root]);
  const reviewQueue = useMemo(
    () => new ReviewQueue(cardStore, new Sm2SchedulerStrategy()),
    [cardStore],
  );
  const quizHistory = useMemo(() => new QuizHistoryStore(root ?? ''), [root]);

  useEffect(() => {
    const settings = settingsStore.hydrate();
    setAgentProviderId(settings.agentProviderId);
    aiClient.setProvider(
      resolveAiProvider(settings.providerId, settings.openRouterModelId),
    );
    const unsub = settingsStore.subscribe((next) => {
      setAgentProviderId(next.agentProviderId);
      aiClient.setProvider(
        resolveAiProvider(next.providerId, next.openRouterModelId),
      );
    });

    // Prefer OpenRouter automatically when a key is configured and settings still say mock.
    void (async () => {
      try {
        const status = await window.ai?.status();
        if (!status?.configured) return;
        const current = settingsStore.get();
        if (current.providerId === 'mock') {
          settingsStore.setProviderId('openrouter');
        } else {
          aiClient.setProvider(
            resolveAiProvider(current.providerId, current.openRouterModelId),
          );
        }
      } catch {
        // Browser demo / missing bridge — keep mock.
      }
    })();

    return unsub;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_QUIZZES_KEY, JSON.stringify(newQuizPaths));
    } catch {
      // Storage unavailable — badges just won't survive a restart.
    }
  }, [newQuizPaths]);

  // Opening a quiz (from the tree, the toast, or anywhere) clears its badge.
  useEffect(() => {
    setNewQuizPaths((current) => (current.includes(selected) ? current.filter((p) => p !== selected) : current));
  }, [selected]);

  useEffect(() => {
    if (!persistSelectionRef.current || !selected) return;
    try {
      localStorage.setItem(LAST_NOTE_KEY, selected);
    } catch {
      // Storage unavailable — skip remembering.
    }
  }, [selected]);

  useEffect(() => {
    setSlashAiHandler((query) => openAiChat(query));
    return () => setSlashAiHandler(null);
  }, []);

  // Persist into Documents/Concrete so creates/edits survive restarts.
  useEffect(() => {
    if (vault.root) return;
    let cancelled = false;
    void (window.vault?.restore ? vault.restore() : Promise.resolve(null)).then((result) => {
      if (cancelled || !result) return;
      // A successfully restored vault means this user has already completed
      // the vault-selection step; never show first-run onboarding again.
      localStorage.setItem('mv:onboarding-complete', '1');
      setOnboarding(false);
      setContents({});
      setActiveFolder('');
      const lastNote = readLastNote();
      const preferred =
        (lastNote && result.files.includes(lastNote) ? lastNote : '') ||
        (result.files.find((file) => file === 'Welcome.md') ?? result.files[0] ?? '');
      setSelected(preferred);
      persistSelectionRef.current = true;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once when Electron vault API is ready
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

  // External file changes for the open note (including Codex agent edits)
  useEffect(() => {
    if (!root) return;
    return VaultService.onWatch((event) => {
      if (event.root !== root || event.type !== 'change' || event.path !== selected) return;
      void VaultService.read(root, event.path).then((text) => {
        setContents((prev) => ({ ...prev, [event.path]: text }));
        // Chokidar also reports our own autosaves. Re-loading identical
        // content through MDXEditor resets Lexical's selection and scroll
        // position, which makes the cursor jump to the top while typing.
        if (!controller.isDirty && text !== controller.content) {
          controller.loadContent(text);
          controller.markSaved();
          setEditorRevision((n) => n + 1);
        }
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
    let result;
    try {
      result = await vault.open();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not open that vault.');
      return;
    }
    if (!result) return;
    setContents({});
    setActiveFolder('');
    const first = result.files[0] ?? '';
    setSelected(first);
    setOnboardingStep(1);
  };

  const importObsidianVault = async () => {
    try {
      const result = root
        ? await VaultService.importObsidian(root)
        : await vault.openDefault();
      if (!result) return;
      setContents({});
      setActiveFolder('');
      setSelected(result.files[0] ?? '');
      setOnboardingStep(1);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import the Obsidian vault.');
    }
  };

  const select = (name: string) => {
    persistSelectionRef.current = true;
    if (isPdfFileName(name)) {
      // PDFs aren't editable notes — open them in the OS default viewer instead.
      if (root) void VaultService.openPath(root, name);
      setTreeFocus({ kind: 'file', path: name });
      return;
    }
    if (controller.isDirty) void controller.persistence.flush();
    setSelected(name);
    setTreeFocus({ kind: 'file', path: name });
    // Keep activeFolder as the last explicit folder/root click — don't
    // inherit a note's parent (that forced "New folder" into ML etc.).
    const cached = contents[name] ?? demoContent[name];
    if (cached !== undefined) {
      controller.loadContent(cached);
    }
  };

  /** Folder target for new notes: explicit selection, else sibling of current note. */
  const noteTargetFolder = activeFolder || parentDir(selected);

  const finishNewNote = (relative: string, body?: string) => {
    const title = relative.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled';
    const content = body ?? `# ${title}\n\n`;
    setContents((prev) => ({ ...prev, [relative]: content }));
    setSelected(relative);
    setTreeFocus({ kind: 'file', path: relative });
    controller.loadContent(content);
  };

  const createDemoNote = (relative: string, body?: string) => {
    vault.setFiles((current) =>
      current.includes(relative)
        ? current
        : [...current, relative].sort((a, b) => a.localeCompare(b)),
    );
    const parent = parentDir(relative);
    if (parent) {
      vault.setFolders((current) => ensureFolderAncestors(current, parent));
    }
    finishNewNote(relative, body);
  };

  const create = async () => {
    if (controller.isDirty) await controller.persistence.flush();
    const name = await askText(
      noteTargetFolder ? `New note in ${noteTargetFolder}` : 'New note name',
    );
    if (!name) return;
    const relative = joinNotePath(noteTargetFolder, name);
    if (!relative) return;

    if (canUseDiskVault(root)) {
      try {
        const created = await vault.create(relative);
        finishNewNote(created);
        return;
      } catch (error) {
        console.error('Failed to create note on disk', error);
        window.alert(
          error instanceof Error
            ? error.message
            : 'Could not create that note. Try a simpler name.',
        );
        return;
      }
    }

    createDemoNote(relative);
  };

  const createQuiz = () => {
    setGenerateQuizOpen(true);
  };

  const loadNoteBody = async (path: string): Promise<string> => {
    if (contents[path] !== undefined) return contents[path];
    if (demoContent[path] !== undefined) return demoContent[path];
    if (canUseDiskVault(root)) {
      try {
        return await vault.read(path);
      } catch {
        return '';
      }
    }
    return '';
  };

  const confirmGenerateQuiz = async (result: GenerateQuizDialogResult) => {
    if (quizJob.status === 'running') return;
    if (controller.isDirty) await controller.persistence.flush();

    const sourcePaths = result.sourcePaths.filter((path) => !isQuizPath(path));
    if (sourcePaths.length === 0) {
      window.alert('Select at least one source note.');
      return;
    }

    const titled = result.title;
    const primary = sourcePaths[0];
    const saveFolder = parentDir(primary) || activeFolder;
    const relative = joinNotePath(saveFolder, titled);
    if (!relative) return;

    // Close dialog immediately — generation continues in the background.
    setGenerateQuizOpen(false);
    const jobId = ++quizJobRef.current;
    setQuizJob({ status: 'running', title: titled });

    const quizSettings = result.settings;
    const types = [
      ...(quizSettings.mcqCount > 0 ? (['mcq'] as const) : []),
      ...(quizSettings.clozeCount > 0 ? (['cloze'] as const) : []),
      ...(quizSettings.openCount > 0 ? (['open'] as const) : []),
      ...(quizSettings.codeCount > 0 ? (['code'] as const) : []),
    ];

    try {
      const chunks: string[] = [];
      for (const path of sourcePaths) {
        const body = await loadNoteBody(path);
        chunks.push(`### File: ${path}\n\n${body.trim()}`);
      }
      const noteContext = chunks.join('\n\n-----\n\n');

      // Code questions are checked by running them, and some fail that check.
      // Ask for one spare when a runner is available so the requested count holds.
      const sandboxProviderId = settingsStore.get().sandboxProviderId;
      const sandboxReady =
        quizSettings.codeCount > 0 && (await getSandboxStatus(sandboxProviderId)).available;

      const generated = await aiClient.generateQuiz({
        topic: titled.replace(/^Quiz\s+/, ''),
        noteContext: truncateNoteContext(noteContext, 12000),
        source: primary,
        sources: sourcePaths,
        types,
        mcqCount: quizSettings.mcqCount,
        clozeCount: quizSettings.clozeCount,
        openCount: quizSettings.openCount,
        codeCount: quizSettings.codeCount + (sandboxReady ? 1 : 0),
        difficulty: quizSettings.difficulty,
        customRubric: quizSettings.customRubric.trim() || undefined,
      });
      const verification = await verifyCodeQuestions(generated, sandboxProviderId);
      const doc = verification.doc;
      // Models sometimes satisfy the requested composition twice. Enforce the
      // user's counts before saving so the quiz cannot silently grow.
      const limits = { mcq: quizSettings.mcqCount, cloze: quizSettings.clozeCount, open: quizSettings.openCount, code: quizSettings.codeCount };
      const used = { mcq: 0, cloze: 0, open: 0, code: 0 };
      doc.questions = doc.questions.filter((question) => {
        if (used[question.type] >= limits[question.type]) return false;
        used[question.type] += 1;
        return true;
      });
      doc.title = titled;
      doc.source = primary;
      if (quizSettings.customRubric.trim()) {
        doc.rubric = quizSettings.customRubric.trim();
      }
      const body = quizDocumentToMarkdown(doc, titled);

      let createdPath = relative;
      if (canUseDiskVault(root)) {
        const created = await vault.create(relative);
        await vault.write(created, body);
        createdPath = created;
        setContents((prev) => ({ ...prev, [created]: body }));
        // Don't steal focus mid-edit — toast lets the user open it.
      } else {
        vault.setFiles((current) =>
          current.includes(relative)
            ? current
            : [...current, relative].sort((a, b) => a.localeCompare(b)),
        );
        const parent = parentDir(relative);
        if (parent) {
          vault.setFolders((current) => ensureFolderAncestors(current, parent));
        }
        setContents((prev) => ({ ...prev, [relative]: body }));
      }

      setNewQuizPaths((current) => (current.includes(createdPath) ? current : [...current, createdPath]));
      if (quizJobRef.current === jobId) {
        const keptCode = used.code;
        const note =
          quizSettings.codeCount > 0 && keptCode < quizSettings.codeCount
            ? `${keptCode} of ${quizSettings.codeCount} code questions passed verification.`
            : verification.unverified > 0
              ? 'Code answers are unverified — start Docker to check them.'
              : undefined;
        setQuizJob({ status: 'done', title: titled, path: createdPath, note });
      }
    } catch (error) {
      console.error('Quiz generation failed', error);
      if (quizJobRef.current === jobId) {
        setQuizJob({
          status: 'error',
          title: titled,
          message:
            error instanceof Error
              ? error.message
              : 'Quiz generation failed. Check OpenRouter key / network and try again.',
        });
      }
    }
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

  const renameTreeItem = async (
    path: string,
    kind: TreeItemKind,
    nextName: string,
  ) => {
    const cleaned = nextName.trim();
    if (!cleaned) return;

    if (kind === 'folder') {
      const parent = parentDir(path);
      const target = joinFolderPath(parent, cleaned);
      if (!target || target === path) return;
      if (canUseDiskVault(root)) {
        try {
          const renamed = await vault.rename(path, target);
          setContents((prev) => {
            const copy: Record<string, string> = {};
            for (const [key, value] of Object.entries(prev)) {
              if (key === path || key.startsWith(`${path}/`)) {
                copy[`${renamed}${key.slice(path.length)}`] = value;
              } else {
                copy[key] = value;
              }
            }
            return copy;
          });
          if (selected === path || selected.startsWith(`${path}/`)) {
            const nextSelected = `${renamed}${selected.slice(path.length)}`;
            setSelected(nextSelected);
          }
          if (activeFolder === path || activeFolder.startsWith(`${path}/`)) {
            setActiveFolder(`${renamed}${activeFolder.slice(path.length)}`);
          }
          setTreeFocus({ kind: 'folder', path: renamed });
        } catch (error) {
          console.error('Failed to rename folder', error);
          window.alert(
            error instanceof Error ? error.message : 'Could not rename that folder.',
          );
        }
        return;
      }
      vault.setFolders((current) =>
        current
          .map((folder) => {
            if (folder === path) return target;
            if (folder.startsWith(`${path}/`)) return `${target}${folder.slice(path.length)}`;
            return folder;
          })
          .sort((a, b) => a.localeCompare(b)),
      );
      vault.setFiles((current) =>
        current
          .map((file) =>
            file.startsWith(`${path}/`) ? `${target}${file.slice(path.length)}` : file,
          )
          .sort((a, b) => a.localeCompare(b)),
      );
      setContents((prev) => {
        const copy: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (key.startsWith(`${path}/`)) copy[`${target}${key.slice(path.length)}`] = value;
          else copy[key] = value;
        }
        return copy;
      });
      if (selected.startsWith(`${path}/`)) {
        setSelected(`${target}${selected.slice(path.length)}`);
      }
      if (activeFolder === path || activeFolder.startsWith(`${path}/`)) {
        setActiveFolder(`${target}${activeFolder.slice(path.length)}`);
      }
      setTreeFocus({ kind: 'folder', path: target });
      return;
    }

    if (isPdfFileName(path)) {
      const folder = parentDir(path);
      const target = cleaned.startsWith('@root/')
        ? cleaned.slice('@root/'.length)
        : cleaned.includes('/') ? cleaned : joinPdfPath(folder, cleaned);
      if (!target || target === path) return;
      if (canUseDiskVault(root)) {
        try {
          const renamed = await vault.rename(path, target);
          setTreeFocus({ kind: 'file', path: renamed });
        } catch (error) {
          console.error('Failed to rename PDF', error);
          window.alert(
            error instanceof Error ? error.message : 'Could not rename that PDF.',
          );
        }
        return;
      }
      vault.setPdfFiles((current) =>
        current.map((f) => (f === path ? target : f)).sort(),
      );
      setTreeFocus({ kind: 'file', path: target });
      return;
    }

    const folder = parentDir(path);
    const target = cleaned.startsWith('@root/')
      ? cleaned.slice('@root/'.length)
      : cleaned.includes('/') ? cleaned : joinNotePath(folder, cleaned);
    if (!target || target === path) return;
    if (canUseDiskVault(root)) {
      try {
        const renamed = await vault.rename(path, target);
        setContents((prev) => {
          const copy = { ...prev };
          copy[renamed] = copy[path] ?? controller.content;
          delete copy[path];
          return copy;
        });
        if (selected === path) setSelected(renamed);
        setTreeFocus({ kind: 'file', path: renamed });
      } catch (error) {
        console.error('Failed to rename note', error);
        window.alert(
          error instanceof Error ? error.message : 'Could not rename that note.',
        );
      }
      return;
    }
    vault.setFiles((current) =>
      current.map((f) => (f === path ? target : f)).sort(),
    );
    setContents((prev) => {
      const copy = { ...prev };
      copy[target] = copy[path] ?? controller.content;
      delete copy[path];
      return copy;
    });
    if (selected === path) setSelected(target);
    setTreeFocus({ kind: 'file', path: target });
  };

  const deleteTreeItem = async (item: { kind: TreeItemKind; path: string }) => {
    const { kind, path } = item;
    if (!path) return;
    const label = kind === 'folder' ? path : noteTitle(path);
    const message =
      kind === 'folder'
        ? `Delete folder “${label}” and everything inside it?`
        : `Delete “${label}”?`;
    if (!window.confirm(message)) return;

    if (canUseDiskVault(root)) {
      try {
        await vault.delete(path);
      } catch (error) {
        console.error('Failed to delete', error);
        window.alert(
          error instanceof Error ? error.message : 'Could not delete that item.',
        );
        return;
      }
    } else if (kind === 'folder') {
      vault.setFolders((current) =>
        current.filter((folder) => folder !== path && !folder.startsWith(`${path}/`)),
      );
      vault.setFiles((current) =>
        current.filter((file) => file !== path && !file.startsWith(`${path}/`)),
      );
    } else {
      vault.setFiles((current) => current.filter((f) => f !== path));
    }

    setContents((prev) => {
      const copy = { ...prev };
      if (kind === 'folder') {
        for (const key of Object.keys(copy)) {
          if (key === path || key.startsWith(`${path}/`)) delete copy[key];
        }
      } else {
        delete copy[path];
      }
      return copy;
    });

    if (kind === 'folder') {
      if (activeFolder === path || activeFolder.startsWith(`${path}/`)) {
        setActiveFolder('');
      }
      if (selected === path || selected.startsWith(`${path}/`)) {
        const remaining = files.filter(
          (f) => f !== path && !f.startsWith(`${path}/`),
        );
        setSelected(remaining[0] ?? '');
      }
    } else if (selected === path) {
      const remaining = files.filter((f) => f !== path);
      setSelected(remaining[0] ?? '');
    }

    setTreeFocus(null);
  };

  const deleteSelected = async () => {
    const item = treeFocus ?? (selected ? { kind: 'file' as const, path: selected } : null);
    if (!item) return;
    await deleteTreeItem(item);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || (event.key !== 'Backspace' && event.key !== 'Delete')) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        Boolean(target?.isContentEditable);
      if (typing) return;

      const item =
        treeFocus ?? (selected ? { kind: 'file' as const, path: selected } : null);
      if (!item?.path) return;

      const focusEl = (document.activeElement as HTMLElement | null) ?? target;
      const inTree = Boolean(focusEl?.closest?.('.sidebar, .file-tree'));
      if (!inTree && !treeFocus) return;

      event.preventDefault();
      void deleteTreeItem(item);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeFocus, selected]);

  const saved = !controller.isDirty;
  const findMatches = findQuery.trim()
    ? (controller.content.toLowerCase().match(new RegExp(findQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    : 0;
  useEffect(() => {
    if (!findOpen || !findQuery.trim()) return;
    const timer = window.setTimeout(() => {
      (window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean) => boolean }).find?.(findQuery, false, false);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [findOpen, findQuery, selected]);
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
      <aside className="rail" aria-label="Primary">
        <IconButton
          type="button"
          className={
            rail === 'files' && layout.sidebarOpen && !layout.focusMode
              ? 'rail-button active'
              : 'rail-button'
          }
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Files"
          aria-pressed={rail === 'files' && layout.sidebarOpen && !layout.focusMode}
          onClick={() => selectRail('files')}
        >
          <FileTextIcon width={18} height={18} />
        </IconButton>
        <IconButton
          type="button"
          className={
            rail === 'tags' && layout.sidebarOpen && !layout.focusMode
              ? 'rail-button active'
              : 'rail-button'
          }
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Tags"
          aria-pressed={rail === 'tags' && layout.sidebarOpen && !layout.focusMode}
          onClick={() => selectRail('tags')}
        >
          <BadgeIcon width={18} height={18} />
        </IconButton>
        <IconButton
          type="button"
          className={rail === 'ai' || aiChatOpen ? 'rail-button active' : 'rail-button'}
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Tutor"
          aria-pressed={rail === 'ai' || aiChatOpen}
          onClick={() => selectRail('ai')}
        >
          <Bot size={18} />
        </IconButton>
        <div className="rail-spacer" />
        <IconButton
          type="button"
          className={layout.focusMode ? 'rail-button active' : 'rail-button'}
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label={layout.focusMode ? 'Exit focus mode' : 'Focus mode'}
          aria-pressed={layout.focusMode}
          onClick={toggleFocusMode}
        >
          {layout.focusMode ? (
            <Minimize2 size={18} />
          ) : (
            <Expand size={18} />
          )}
        </IconButton>
        <IconButton
          type="button"
          className="rail-button"
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Settings"
          onClick={() => setOverlay('settings')}
        >
          <GearIcon width={18} height={18} />
        </IconButton>
      </aside>

      <aside className="sidebar" aria-hidden={!layout.sidebarOpen || layout.focusMode}>
        {rail === 'tags' ? (
          <>
            <Flex className="sidebar-heading" align="center" justify="between" px="3">
              <Text size="1" color="gray" weight="bold">
                TAGS
              </Text>
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                aria-label="Collapse sidebar"
                onClick={() => setSidebarOpen(false)}
              >
                <Cross1Icon />
              </IconButton>
            </Flex>
            <div className="file-tree tag-list">
              {allTags.length === 0 ? (
                <Text size="2" color="gray" mx="3">
                  No tags yet
                </Text>
              ) : (
                allTags.map((tag) => (
                  <button
                    type="button"
                    className="file-row"
                    key={tag}
                    onClick={() => setQuery(`#${tag}`)}
                  >
                    <BadgeIcon width={14} height={14} />
                    <span>{tag}</span>
                    <Text size="1" color="gray" className="tag-count">
                      {meta.getNotesWithTag(tag).length}
                    </Text>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div
              className="sidebar-heading sidebar-heading-minimal"
              onClick={(event) => {
                // Clicking the actions strip (not a button) targets vault root.
                if (event.target === event.currentTarget) setActiveFolder('');
              }}
            >
              <Flex
                className="sidebar-heading-actions"
                justify="center"
                gap="2"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setActiveFolder('');
                }}
              >
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label="New folder"
                  onClick={createFolder}
                >
                  <PlusCircledIcon width={16} height={16} />
                </IconButton>
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label={
                    noteTargetFolder ? `New note in ${noteTargetFolder}` : 'New note'
                  }
                  onClick={create}
                >
                  <FilePlusIcon width={16} height={16} />
                </IconButton>
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label="Delete note"
                  onClick={deleteSelected}
                >
                  <TrashIcon width={15} height={15} />
                </IconButton>
              </Flex>
            </div>
            <FileTreeView
              files={pdfFiles.length > 0 ? [...files, ...pdfFiles] : files}
              folders={vault.folders}
              selected={selected}
              activeFolder={activeFolder}
              filterPaths={filterPaths}
              newPaths={newQuizPaths}
              onSelectFile={select}
              onSelectFolder={(path) => {
                setActiveFolder(path);
                setTreeFocus(path ? { kind: 'folder', path } : null);
              }}
              onRename={renameTreeItem}
              onDelete={(path, kind) => void deleteTreeItem({ path, kind })}
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
            <IconButton
              type="button"
              className="tabs-collapse"
              size="2"
              variant="ghost"
              color="gray"
              highContrast
              aria-label={layout.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              onClick={() => setSidebarOpen(!layout.sidebarOpen)}
            >
              {layout.sidebarOpen ? (
                <ArrowLeftFromLine size={16} />
              ) : (
                <ArrowRightFromLine size={16} />
              )}
            </IconButton>
          )}
          <div className="tab active" title={selected}>
            {isQuizPath(selected) ? (
              <ClipboardIcon width={14} height={14} />
            ) : (
              <FileTextIcon width={14} height={14} />
            )}
            <span className="tab-title" title={selected}>
              {tabTitleFor(selected)}
            </span>
            {!saved && <span className="dirty">•</span>}
          </div>
          <div className="tab-spacer" />
          {!isQuizPath(selected) && noteTags.length > 0 && (
            <div className="note-tags">
              {noteTags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          )}
          <Flex className="tabs-actions" align="center" gap="3" pr="3">
            <IconButton
              type="button"
              size="2"
              variant={layout.focusMode ? 'soft' : 'ghost'}
              color="gray"
              highContrast
              aria-label={layout.focusMode ? 'Exit focus mode (Esc)' : 'Focus mode (⌘⇧F)'}
              onClick={toggleFocusMode}
            >
              {layout.focusMode ? <Minimize2 size={16} /> : <Expand size={16} />}
            </IconButton>
            {!layout.focusMode && (
              <IconButton
                type="button"
                size="2"
                variant="ghost"
                color="gray"
                highContrast
                aria-label={layout.rightOpen ? 'Hide right panel' : 'Show right panel'}
                onClick={() => setRightOpen(!layout.rightOpen)}
              >
                {layout.rightOpen ? (
                  <ArrowRightFromLine size={16} />
                ) : (
                  <ArrowLeftFromLine size={16} />
                )}
              </IconButton>
            )}
            {!isQuizPath(selected) && selected ? (
              <Button
                size="1"
                highContrast
                disabled={generatingQuiz}
                loading={generatingQuiz}
                onClick={createQuiz}
              >
                <ClipboardIcon />
                Generate quiz
              </Button>
            ) : null}
          </Flex>
        </div>
        <div className="editor-wrap">
          {findOpen ? (
            <div className="find-bar" role="search">
              <input
                ref={findInputRef}
                value={findQuery}
                placeholder="Find in file"
                aria-label="Find in current file"
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFindOpen(false);
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    (window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean) => boolean }).find?.(
                      findQuery,
                      false,
                      event.shiftKey,
                    );
                    requestAnimationFrame(() => findInputRef.current?.focus());
                  }
                }}
              />
              <span>{findMatches ? `${findMatches} match${findMatches === 1 ? '' : 'es'}` : 'No matches'}</span>
              <button
                type="button"
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                onClick={() => {
                  findInputRef.current?.focus();
                  (window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean) => boolean }).find?.(findQuery, false, true);
                  findInputRef.current?.focus();
                }}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                aria-label="Next match"
                title="Next match (Enter)"
                onClick={() => {
                  findInputRef.current?.focus();
                  (window as Window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean) => boolean }).find?.(findQuery, false, false);
                  findInputRef.current?.focus();
                }}
              >
                <ChevronDown size={14} />
              </button>
              <button type="button" onClick={() => setFindOpen(false)} aria-label="Close find">×</button>
            </div>
          ) : null}
          {isQuizPath(selected) ? (
            <QuizShell
              documentPath={selected}
              historyStore={quizHistory}
              markdown={controller.content}
              client={aiClient}
              onChange={(value) => {
                controller.setContent(value);
                setContents((prev) => ({ ...prev, [selected]: value }));
              }}
              onBlur={() => void controller.persistence.flush()}
            />
          ) : (
            <WysiwygEditor
              className="wysiwyg"
              documentId={selected}
              contentRevision={editorRevision}
              markdown={controller.content}
              onChange={(value) => {
                controller.setContent(value);
                setContents((prev) => ({ ...prev, [selected]: value }));
              }}
              onBlur={() => void controller.persistence.flush()}
            />
          )}
        </div>
        <AiOrb
          client={aiClient}
          noteContext={truncateNoteContext(controller.content)}
          notePath={selected}
          vaultRoot={root}
          agentProviderId={agentProviderId}
          open={aiChatOpen}
          onOpenChange={setAiChatOpen}
          seedPrompt={aiSeedPrompt}
          onSeedConsumed={() => setAiSeedPrompt(null)}
          onBeforeAgentRun={async () => {
            if (controller.isDirty) await controller.persistence.flush();
          }}
          onAfterAgentRun={async () => {
            if (!root || !selected) return;
            try {
              const text = await VaultService.read(root, selected);
              setContents((prev) => ({ ...prev, [selected]: text }));
              controller.loadContent(text);
              controller.markSaved();
              setEditorRevision((n) => n + 1);
            } catch {
              // Watcher may still pick up the change.
            }
          }}
        />
        <footer className="statusbar">
          <span>{controller.content.length} characters</span>
          <span>•</span>
          <span>{root ? 'Saved to disk' : 'In-memory demo'}</span>
          <span className="status-spacer" />
          {layout.focusMode ? <span>Focus mode · Esc to exit</span> : <span>{saved ? 'Saved' : 'Editing'}</span>}
        </footer>
      </main>

      <aside className="right-panel" aria-hidden={!layout.rightOpen || layout.focusMode}>
        <div className="panel-title-row">
          <div className="panel-title">BACKLINKS</div>
        </div>
        {backlinks.length === 0 ? (
          <div className="empty-panel">
            <BadgeIcon width={18} height={18} />
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
                <FileTextIcon width={14} height={14} />
                <span>{hit.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="panel-section">
          <ProgressPanel store={quizHistory} folder={parentDir(selected)} />
          <span className="sr-only">{dueTick}</span>
        </div>
      </aside>

      {generateQuizOpen && (
        <GenerateQuizDialog
          files={files}
          defaultSourcePath={selected}
          folderHint={
            selected && !isQuizPath(selected)
              ? parentDir(selected) || 'vault root'
              : activeFolder || 'vault root'
          }
          defaultSettings={settingsStore.get().quiz}
          busy={false}
          onCancel={() => setGenerateQuizOpen(false)}
          onConfirm={(result) => void confirmGenerateQuiz(result)}
        />
      )}

      {quizJob.status !== 'idle' && (
        <div
          className={`mv-toast mv-toast-${quizJob.status}`}
          role="status"
          aria-live="polite"
        >
          {quizJob.status === 'running' ? (
            <>
              <Loader2 size={16} className="mv-toast-spin" aria-hidden />
              <div className="mv-toast-body">
                <strong>Generating quiz</strong>
                <span>{quizJob.title}</span>
              </div>
            </>
          ) : null}
          {quizJob.status === 'done' ? (
            <>
              <ClipboardIcon width={16} height={16} aria-hidden />
              <div className="mv-toast-body">
                <strong>Quiz ready</strong>
                <span>{quizJob.title}</span>
                {quizJob.note ? <span>{quizJob.note}</span> : null}
              </div>
              <Button
                size="1"
                highContrast
                onClick={() => {
                  const path = quizJob.path;
                  setQuizJob({ status: 'idle' });
                  void (async () => {
                    if (controller.isDirty) await controller.persistence.flush();
                    const body = await loadNoteBody(path);
                    setContents((prev) => ({ ...prev, [path]: body }));
                    setSelected(path);
                    setTreeFocus({ kind: 'file', path });
                    controller.loadContent(body);
                  })();
                }}
              >
                Open
              </Button>
            </>
          ) : null}
          {quizJob.status === 'error' ? (
            <>
              <div className="mv-toast-body">
                <strong>Quiz failed</strong>
                <span>{quizJob.message}</span>
              </div>
            </>
          ) : null}
          {quizJob.status !== 'running' ? (
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Dismiss"
              onClick={() => setQuizJob({ status: 'idle' })}
            >
              <Cross1Icon width={12} height={12} />
            </IconButton>
          ) : null}
        </div>
      )}

      {onboarding && (
        <div
          className="mv-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={onboardingMode === 'tour' ? 'Why Concrete' : 'Welcome to Concrete'}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && onboardingMode === 'tour') {
              localStorage.setItem('mv:onboarding-complete', '1');
              setOnboarding(false);
            }
          }}
        >
          <div
            className="mv-settings-panel-shell"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mv-settings-panel">
              {onboardingMode === 'welcome' ? (
                <>
                  <h2>Welcome to Concrete</h2>
                  <p>
                    Choose where your local Markdown vault should live. Concrete will remember it
                    and open it automatically next time.
                  </p>
                  <Flex direction="column" gap="2" mt="3">
                    <Button
                      type="button"
                      onClick={() => {
                        void openVault().then(() => {
                          localStorage.setItem('mv:onboarding-complete', '1');
                          setOnboarding(false);
                        });
                      }}
                    >
                      Choose a vault folder
                    </Button>
                    <Button
                      type="button"
                      variant="soft"
                      onClick={() => {
                        void importObsidianVault().then(() => {
                          localStorage.setItem('mv:onboarding-complete', '1');
                          setOnboarding(false);
                        });
                      }}
                    >
                      Import Obsidian Vault
                    </Button>
                    <Button
                      type="button"
                      variant="soft"
                      color="gray"
                      onClick={() => {
                        setOnboardingMode('tour');
                        setOnboardingStep(0);
                      }}
                    >
                      Explore demo
                    </Button>
                  </Flex>
                </>
              ) : (
                <ProductTour
                  stepIndex={onboardingStep}
                  onStepIndexChange={setOnboardingStep}
                  onClose={() => {
                    localStorage.setItem('mv:onboarding-complete', '1');
                    setOnboarding(false);
                    setOnboardingMode('welcome');
                    setOnboardingStep(0);
                  }}
                  onFinished={() => {
                    localStorage.setItem('mv:onboarding-complete', '1');
                    setOnboarding(false);
                    setOnboardingMode('welcome');
                    setOnboardingStep(0);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {overlay === 'settings' && (
        <div
          className="mv-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverlay(null);
          }}
        >
          <div
            className="mv-settings-panel-shell"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <SettingsPanel
              store={settingsStore}
              vaultRoot={root}
              onOpenVault={() => { void openVault().then(() => setOverlay(null)); }}
              onImportObsidian={() => { void importObsidianVault().then(() => setOverlay(null)); }}
              onReplayOnboarding={() => {
                setOverlay(null);
                setOnboardingMode('tour');
                setOnboardingStep(0);
                setOnboarding(true);
              }}
              providerOptions={[
                { id: 'openrouter', label: 'OpenRouter' },
                { id: 'mock', label: 'Mock AI' },
                { id: 'local-echo', label: 'Local Echo' },
              ]}
              onClose={() => setOverlay(null)}
            />
          </div>
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
