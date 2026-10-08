import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button, Flex, IconButton, Text } from '@radix-ui/themes';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardIcon,
  Cross1Icon,
  LayersIcon,
  MagnifyingGlassIcon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  FilePlusIcon,
  FileTextIcon,
  GearIcon,
  BadgeIcon,
  PlusCircledIcon,
  TrashIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';
import { WysiwygEditor, useEditorController, type WysiwygEditorHandle } from './editor';
import { normalizePastedMathMarkdown, preferOneLineDisplayMath } from './editor/math';
import { noteExportTitle } from './export/prepareNoteMarkdown';
import type { ChatInsertTarget } from './ai/chat/StudyChatPane';
import {
  askText,
  canMkdir,
  canUseDiskVault,
  ensureFolderAncestors,
  FileTreeView,
  isPdfFileName,
  isHiddenVaultFile,
  joinFolderPath,
  joinNotePath,
  joinPdfPath,
  closeNoteTab,
  NoteBodyCache,
  noteTitle,
  openNoteInTabs,
  previewNoteInTabs,
  OpenTabsBar,
  PdfView,
  parentDir,
  renamePathsInTabs,
  tabAfterClose,
  useVault,
  VaultService,
  type TreeItemKind,
} from './vault';
import { useBacklinks } from './graph';

const NOTE_BODY_CACHE_MAX = 24;
import { SearchIndex, SearchPalette, useSearch, type SearchResult } from './search';
import {
  applyTextHighlights,
  clearTextHighlights,
  findTextRanges,
  revealTextRange,
  waitForTextRanges,
} from './search/inFileFind';
import { MetaService } from './meta';
import {
  appendCardLines,
  applyCardEdit,
  CreateCardsPanel,
  deckFilter,
  quizQuestionForCard,
  NoteCardsPanel,
  QuizReviewToggle,
  ReviewSession,
  ReviewSidebar,
  ReviewView,
  useReviewSystem,
  cardsFromNote,
  type CardEdit,
  type Deck,
  type ReviewCard,
} from './learn';
import {
  aiClient,
  LocalEchoProvider,
  MockAiProvider,
  ChatModelProvider,
  setSlashAiHandler,
  truncateNoteContext,
} from './ai';
import {
  isQuizPath,
  nextQuizTitle,
  quizDocumentToMarkdown,
  QuizShell,
  type GenerateQuizDialogResult,
  ProgressPanel,
  quizGradingJobs,
} from './quiz';
import { notePathKey, QuizFromNotePrompt, quizSourceFromMarkdown } from './quiz/QuizFromNotePrompt';
import { QuizHistoryStore } from './quiz';
import { buildPdfContext, cleanPdfPages, parsePageRange } from './quiz/pdfContext';
import { AUTO_QUIZ_ANALYSIS_SYSTEM, parseAutoQuizCounts, type AutoQuizCounts } from './quiz/autoComposition';
import { settingsStore } from './settings';
import { BrandLogo } from './branding/BrandLogo';
import { getSandboxStatus } from './sandbox';
import { verifyCodeQuestions } from './quiz/verifyCode';
import type { AgentProviderId, AppSettings } from './settings';
import { ProductTour } from './onboarding';

const SettingsPanel = lazy(() =>
  import('./settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);
/** Total source text sent for quiz generation (the provider truncates at this too). */
const QUIZ_CONTEXT_CHARS = 12000;

const GenerateQuizDialog = lazy(() =>
  import('./quiz/GenerateQuizDialog').then((m) => ({ default: m.GenerateQuizDialog })),
);
const StudyChatPane = lazy(() =>
  import('./ai/chat/StudyChatPane').then((m) => ({ default: m.StudyChatPane })),
);

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

type RailView = 'files' | 'tags' | 'review' | 'ai';
type Overlay = 'settings' | 'search' | null;

const LAYOUT_KEY = 'mv:layout';
const LAST_NOTE_KEY = 'mv:last-note';
const STUDY_CHAT_KEY = 'mv:study-chat';
const STUDY_CHAT_MIN_WIDTH = 320;
const STUDY_CHAT_DEFAULT_WIDTH = 440;
/** Keep at least this much room for the note beside the chat. */
const STUDY_CHAT_EDITOR_MIN = 320;

function loadStudyChatLayout(): { open: boolean; width: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDY_CHAT_KEY) ?? '{}');
    return {
      open: parsed.open === true,
      width: typeof parsed.width === 'number' ? parsed.width : STUDY_CHAT_DEFAULT_WIDTH,
    };
  } catch {
    return { open: false, width: STUDY_CHAT_DEFAULT_WIDTH };
  }
}
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

function resolveAiProvider(settings: AppSettings) {
  switch (settings.providerId) {
    case 'openrouter':
      return new ChatModelProvider('openrouter', settings.openRouterModelId);
    case 'claude':
      return new ChatModelProvider('claude', settings.claudeModelId);
    case 'codex':
      return new ChatModelProvider('codex');
    case 'local-echo':
      return new LocalEchoProvider();
    default:
      return new MockAiProvider();
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'EEXIST' || /EEXIST|already exists/i.test(message);
}

export default function App() {
  const vault = useVault(demoNotes, demoFolders);
  const [selected, setSelected] = useState('Welcome.md');
  const [openTabs, setOpenTabs] = useState<string[]>(['Welcome.md']);
  const [previewTab, setPreviewTab] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  // Editor text is asynchronous; track its note before using it for caching.
  const editorPathRef = useRef(selected);
  // Only remember the open note once the restored/initial selection is settled,
  // so the placeholder default never overwrites the saved one.
  const persistSelectionRef = useRef(false);
  // Generated quizzes the user hasn't opened yet; badged "New" in the tree.
  const [newQuizPaths, setNewQuizPaths] = useState<string[]>(readNewQuizzes);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [seededReviewCards, setSeededReviewCards] = useState(false);
  const [walkthroughNoteCreated, setWalkthroughNoteCreated] = useState(false);
  const [activeFolder, setActiveFolder] = useState('');
  const [treeFocus, setTreeFocus] = useState<{
    kind: TreeItemKind;
    path: string;
  } | null>(null);
  const [contents, setContentsState] = useState<Record<string, string>>({ ...demoContent });
  const noteCacheRef = useRef(new NoteBodyCache(NOTE_BODY_CACHE_MAX));
  const setContents = (
    updater:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => {
    setContentsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const cache = noteCacheRef.current;
      cache.clear();
      cache.clearPins();
      const pins = new Set(openTabsRef.current.filter(Boolean));
      if (selectedRef.current) pins.add(selectedRef.current);
      for (const pin of pins) cache.pin(pin);
      // Insert non-pinned first, then pins last so open tabs stay MRU and
      // never get lost when next has more keys than maxEntries.
      for (const [key, value] of Object.entries(next)) {
        if (pins.has(key)) continue;
        cache.set(key, value);
      }
      for (const pin of pins) {
        if (next[pin] !== undefined) cache.set(pin, next[pin]);
      }
      return cache.toRecord();
    });
  };
  const [query, setQuery] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const findRangesRef = useRef<Range[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [rail, setRail] = useState<RailView>('files');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [aiChatOpen, setAiChatOpen] = useState(() => loadStudyChatLayout().open);
  const [chatWidth, setChatWidth] = useState(() => loadStudyChatLayout().width);
  const [aiSeedPrompt, setAiSeedPrompt] = useState<string | null>(null);
  const [chatQuote, setChatQuote] = useState<string | null>(null);
  const [chatFocusToken, setChatFocusToken] = useState(0);
  const editorRef = useRef<WysiwygEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement>(null);
  const [reviewRun, setReviewRun] = useState<{ id: number; session: ReviewSession; deck: Deck; paused: boolean } | null>(null);
  const [createCardsOpen, setCreateCardsOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());
  const [generateQuizOpen, setGenerateQuizOpen] = useState(false);
  const [quizJob, setQuizJob] = useState<
    | { status: 'idle' }
    | { status: 'running'; title: string }
    | { status: 'done'; title: string; path: string; note?: string }
    | { status: 'error'; title: string; message: string }
  >({ status: 'idle' });
  const generatingQuiz = quizJob.status === 'running';
  const [exportingPdf, setExportingPdf] = useState(false);
  // Quizzes grading in the background keep going when another note is opened.
  const gradingJobs = useSyncExternalStore(quizGradingJobs.subscribe, quizGradingJobs.getAll);
  const quizStatus = useMemo(() => {
    const status: Record<string, 'grading' | 'graded'> = {};
    for (const job of gradingJobs) {
      if (job.status === 'grading') status[job.path] = 'grading';
      else if (job.status === 'graded' && job.unseen) status[job.path] = 'graded';
    }
    return status;
  }, [gradingJobs]);
  const quizJobRef = useRef(0);
  const [quizzedSources, setQuizzedSources] = useState<ReadonlySet<string>>(() => new Set());
  const [quizSourceScan, setQuizSourceScan] = useState(0);
  const [agentProviderId, setAgentProviderId] = useState<AgentProviderId>(
    () => settingsStore.get().agentProviderId,
  );
  const [brandLogo, setBrandLogo] = useState(() => settingsStore.get().brandLogo);
  const [editorRevision, setEditorRevision] = useState(0);

  const openAiChat = (seed?: string) => {
    if (seed?.trim()) setAiSeedPrompt(seed.trim());
    setAiChatOpen(true);
    setChatFocusToken((n) => n + 1);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STUDY_CHAT_KEY, JSON.stringify({ open: aiChatOpen, width: chatWidth }));
    } catch {
      // Storage unavailable — layout resets next launch.
    }
  }, [aiChatOpen, chatWidth]);

  /** Drag the divider between note and chat. */
  const startChatResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const split = editorSplitRef.current;
    if (!split) return;
    event.preventDefault();
    const bounds = split.getBoundingClientRect();
    const onMove = (move: PointerEvent) => {
      const max = Math.max(STUDY_CHAT_MIN_WIDTH, bounds.width - STUDY_CHAT_EDITOR_MIN);
      setChatWidth(Math.round(Math.min(max, Math.max(STUDY_CHAT_MIN_WIDTH, bounds.right - move.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('study-chat-resizing');
    };
    document.body.classList.add('study-chat-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const setSidebarOpen = (sidebarOpen: boolean) =>
    setLayout((current) => ({ ...current, sidebarOpen, focusMode: false }));
  const setRightOpen = (rightOpen: boolean) =>
    setLayout((current) => ({ ...current, rightOpen, focusMode: false }));
  const toggleFocusMode = () =>
    setLayout((current) => ({ ...current, focusMode: !current.focusMode }));

  useEffect(() => {
    if (!onboarding || onboardingStep !== 1) return;
    setRail('files');
    setLayout((current) => ({ ...current, sidebarOpen: true, focusMode: false }));
  }, [onboarding, onboardingStep]);

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
      // ⌘P searches the whole vault.
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setOverlay((current) => (current === 'search' ? null : 'search'));
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      // ⌘J toggles Study Chat.
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setAiChatOpen((open) => {
          if (!open) setChatFocusToken((n) => n + 1);
          return !open;
        });
        return;
      }
      // ⌘L asks Study Chat about the selected note text.
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'l') {
        const target = event.target as HTMLElement | null;
        if (!target?.closest?.('.editor-wrap')) return;
        event.preventDefault();
        const selection =
          editorRef.current?.getSelectionMarkdown().trim() ||
          window.getSelection()?.toString().trim() ||
          '';
        if (selection) setChatQuote(selection);
        setAiChatOpen(true);
        setChatFocusToken((n) => n + 1);
        return;
      }
      if (event.key === 'Escape') {
        if (overlay === 'settings' || overlay === 'search') {
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
      if (aiChatOpen) setAiChatOpen(false);
      else openAiChat();
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

  useEffect(() => {
    let cancelled = false;
    const quizPaths = files.filter((path) => isQuizPath(path));
    void (async () => {
      const sources = new Set<string>();
      await Promise.all(
        quizPaths.map(async (path) => {
          try {
            const cached = noteCacheRef.current.get(path);
            const body =
              cached ??
              (canUseDiskVault(root) ? await vault.read(path) : (demoContent[path] ?? ''));
            const source = quizSourceFromMarkdown(body);
            if (source) sources.add(source);
          } catch {
            // A quiz that cannot be read leaves its note eligible again.
          }
        }),
      );
      if (!cancelled) setQuizzedSources(sources);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, root, quizSourceScan]);

  const quizHistory = useMemo(() => new QuizHistoryStore(root ?? ''), [root]);
  const review = useReviewSystem(root, quizHistory);
  const reviewIndex = review.index;
  const searchIndex = useMemo(() => new SearchIndex(), [root]);

  useEffect(() => {
    const settings = settingsStore.hydrate();
    setAgentProviderId(settings.agentProviderId);
    setBrandLogo(settings.brandLogo);
    aiClient.setProvider(resolveAiProvider(settings));
    const unsub = settingsStore.subscribe((next) => {
      setAgentProviderId(next.agentProviderId);
      setBrandLogo(next.brandLogo);
      aiClient.setProvider(resolveAiProvider(next));
    });

    // Leave the mock for the first live backend that is ready: an OpenRouter
    // key, then a Claude Code or Codex login or API key.
    void (async () => {
      if (settingsStore.get().providerId !== 'mock') return;
      try {
        for (const backend of ['openrouter', 'claude', 'codex'] as const) {
          const status = await window.ai?.status(backend);
          if (!status?.configured) continue;
          if (settingsStore.get().providerId === 'mock') settingsStore.setProviderId(backend);
          return;
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

  // First launch always creates and opens Documents/Concrete before the required tour.
  // Returning users restore their existing vault as usual.
  useEffect(() => {
    if (vault.root) return;
    let cancelled = false;
    const firstRun = !localStorage.getItem('mv:onboarding-complete');
    const restore = () => {
      const opening = firstRun
        ? vault.openDefault()
        : (window.vault?.restore ? vault.restore() : Promise.resolve(null));
      void opening.then(async (result) => {
        if (cancelled || !result) {
          void window.perf?.mark('renderer-interactive');
          return;
        }
        let seededPath = '';
        if (firstRun) {
          const notePaths = result.files.filter((file) => /\.md$/i.test(file) && !isHiddenVaultFile(file));
          const noteBodies = await Promise.all(notePaths.map(async (path) => {
            try {
              return [path, await VaultService.read(result.root, path)] as const;
            } catch {
              return [path, ''] as const;
            }
          }));
          const hasCards = noteBodies.some(([path, body]) => cardsFromNote(path, body).length > 0);
          if (!hasCards && !cancelled) {
            const occupied = new Set(result.files);
            let sampleName = 'Concrete Basics';
            for (let suffix = 2; occupied.has(`${sampleName}.md`); suffix += 1) {
              sampleName = `Concrete Basics ${suffix}`;
            }
            try {
              seededPath = await vault.create(sampleName);
              await VaultService.write(
                result.root,
                seededPath,
                '# Concrete Basics\n\nA few sample cards to try in Review. Edit or delete this note whenever you like.\n\nWhat kind of files does Concrete use? :: Plain Markdown files.\nWhere is the default vault? :: Documents/Concrete.\nHow do you link notes? :: Type [[Note title]].\n',
              );
              setSeededReviewCards(true);
            } catch (error) {
              console.warn('Could not add sample review cards', error);
            }
          }
        }
        if (cancelled) return;
        if (firstRun) {
          setOnboarding(true);
        } else {
          setOnboarding(false);
        }
        setContents({});
        setActiveFolder('');
        const lastNote = readLastNote();
        const visibleFiles = result.files.filter((file) => !isHiddenVaultFile(file));
        if (seededPath && !visibleFiles.includes(seededPath)) visibleFiles.push(seededPath);
        const preferred =
          (lastNote && visibleFiles.includes(lastNote) ? lastNote : '') ||
          (visibleFiles.find((file) => file === 'Welcome.md') ?? visibleFiles[0] ?? '');
        setSelected(preferred);
        setOpenTabs(preferred ? [preferred] : []);
        setPreviewTab(null);
        persistSelectionRef.current = true;
        void window.perf?.mark('renderer-interactive');
      });
    };
    const idleId = window.setTimeout(restore, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(idleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once when Electron vault API is ready
  }, []);

  // A different vault means different cards; drop any review in progress.
  useEffect(() => setReviewRun(null), [root]);

  const rootRef = useRef(root);
  const contentRef = useRef('');
  const markSavedRef = useRef<(content?: string) => void>(() => {});
  rootRef.current = root;

  const controller = useEditorController({
    initialContent: contents[selected] ?? '',
    autosaveMs: settingsStore.get().autosaveMs || 800,
    saveFn: async () => {
      const path = selectedRef.current;
      const vaultRoot = rootRef.current;
      const markdown = contentRef.current;
      if (isPdfFileName(path)) return;
      if (vaultRoot && path) {
        await VaultService.write(vaultRoot, path, markdown);
      }
      setContents((prev) => ({ ...prev, [path]: markdown }));
      markSavedRef.current(markdown);
    },
  });

  contentRef.current = controller.content;
  markSavedRef.current = controller.markSaved;

  // Keep open tabs pinned even when selection changes without a contents rewrite.
  useEffect(() => {
    const cache = noteCacheRef.current;
    cache.clearPins();
    for (const path of openTabs) {
      if (path) cache.pin(path);
    }
    if (selected) cache.pin(selected);
  }, [openTabs, selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // PDFs render in PdfView; keep editorPathRef on the last note so
      // note-only effects (card indexing, external reloads) skip them.
      if (!selected || isPdfFileName(selected)) {
        controller.loadContent('');
        return;
      }
      if (root) {
        try {
          const text = await VaultService.read(root, selected);
          if (cancelled) return;
          setContents((prev) => ({ ...prev, [selected]: text }));
          editorPathRef.current = selected;
          controller.loadContent(text);
          setEditorRevision((n) => n + 1);
          return;
        } catch {
          /* fall through to cache */
        }
      }
      const fallback = contents[selected] ?? demoContent[selected] ?? '';
      editorPathRef.current = selected;
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
      const indexed = entries.map(([path, text]) =>
        path === selectedRef.current && editorPathRef.current === path && contentRef.current
          ? ([path, contentRef.current] as const)
          : ([path, text] as const),
      );
      reviewIndex.replaceAll(indexed);
      searchIndex.replaceAll(indexed);
      setContents((prev) => {
        const next = { ...prev };
        for (const [path, text] of entries) {
          if (
            path === selectedRef.current &&
            editorPathRef.current === path &&
            contentRef.current
          ) {
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

  // Demo mode has no disk to scan; index the in-memory notes instead.
  useEffect(() => {
    if (root) return;
    const entries = files.map((path) => [path, contents[path] ?? demoContent[path] ?? ''] as const);
    reviewIndex.replaceAll(entries);
    searchIndex.replaceAll(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when the file list changes
  }, [root, files, reviewIndex, searchIndex]);

  // Keep cards and search current when notes change on disk (other apps, agents, sync).
  useEffect(() => {
    if (!root) return;
    return VaultService.onWatch((event) => {
      if (event.root !== root || !/\.md$/i.test(event.path)) return;
      if (event.type === 'unlink') {
        reviewIndex.remove(event.path);
        searchIndex.remove(event.path);
        return;
      }
      if (event.type !== 'add' && event.type !== 'change') return;
      // The open note is indexed from the editor instead.
      if (event.path === selectedRef.current) return;
      void VaultService.read(root, event.path).then((text) => {
        reviewIndex.update(event.path, text);
        searchIndex.update(event.path, text);
      });
    });
  }, [root, reviewIndex, searchIndex]);

  // Cards and search terms typed into the open note show up as you write.
  useEffect(() => {
    if (!selected || editorPathRef.current !== selected) return;
    const path = selected;
    const text = controller.content;
    const timer = window.setTimeout(() => {
      reviewIndex.update(path, text);
      searchIndex.update(path, text);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selected, controller.content, reviewIndex, searchIndex]);

  const { backlinks } = useBacklinks(selected, notes);
  const searchResults = useSearch(searchIndex, query);
  const meta = useMemo(() => new MetaService().build(notes), [notes]);
  const allTags = meta.getTags();
  const noteTags = selected ? meta.getTags(selected) : [];

  const filterPaths = (() => {
    const tagMatch = query.trim().match(/^#(\S+)$/);
    if (tagMatch) return meta.getNotesWithTag(tagMatch[1]);
    if (query.trim()) return searchResults.map((r) => r.path);
    return null;
  })();

  const importObsidianVault = async () => {
    try {
      const result = root
        ? await VaultService.importObsidian(root)
        : await vault.openDefault();
      if (!result) return;
      setContents({});
      setActiveFolder('');
      const first = result.files.find((file) => !isHiddenVaultFile(file)) ?? '';
      setSelected(first);
      setOpenTabs(first ? [first] : []);
      setPreviewTab(null);
      setOnboardingStep(1);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import the Obsidian vault.');
    }
  };

  const importNotionExport = async () => {
    try {
      const result = await VaultService.importNotion(root);
      if (!result) return;
      setContents({});
      setActiveFolder('');
      const first = result.files.find((file) => !isHiddenVaultFile(file)) ?? '';
      setSelected(first);
      setOpenTabs(first ? [first] : []);
      setPreviewTab(null);
      setOnboardingStep(1);
      const summary = result.importSummary;
      const warningText = summary.warnings.length ? `\nWarnings: ${summary.warnings.length}` : '';
      window.alert(
        `Notion import complete: ${summary.importedNotes.length} notes imported, `
        + `${summary.skippedNotes.length} existing notes skipped, `
        + `${summary.removedFiles.length} empty/broken files omitted, `
        + `${summary.uncertainFilesKept.length} uncertain files kept, `
        + `${summary.preservedFiles.length} other files preserved, `
        + `${summary.skippedFiles.length} existing files skipped.${warningText}`,
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import the Notion export.');
    }
  };

  const select = (name: string, options?: { recordTab?: boolean; preview?: boolean }) => {
    persistSelectionRef.current = true;
    if (controller.isDirty) void controller.persistence.flush();
    // Opening a note sets a running review aside; its tab resumes it.
    setReviewRun((current) => (current && !current.paused ? { ...current, paused: true } : current));
    if (options?.preview) {
      const alreadyPinned = openTabsRef.current.includes(name) && previewTab !== name;
      if (!alreadyPinned) setPreviewTab(name);
      setOpenTabs((tabs) => previewNoteInTabs(tabs, previewTab, name));
    } else {
      if (previewTab === name) setPreviewTab(null);
      if (options?.recordTab !== false) setOpenTabs((tabs) => openNoteInTabs(tabs, name));
    }
    setSelected(name);
    setTreeFocus({ kind: 'file', path: name });
    if (isQuizPath(name)) setCreateCardsOpen(false);
    // Keep activeFolder as the last explicit folder/root click — don't
    // inherit a note's parent (that forced "New folder" into ML etc.).
    const cached = contents[name] ?? demoContent[name];
    if (cached !== undefined) {
      editorPathRef.current = name;
      controller.loadContent(cached);
    }
  };

  /** Open a search hit and, for heading/body matches, jump to the first match. */
  const openSearchResult = (path: string, result?: SearchResult) => {
    setOverlay(null);
    select(path);
    const needle = result && result.field !== 'title' ? result.matches[0] : undefined;
    if (!needle) return;
    setFindQuery(needle);
    setFindIndex(0);
    setFindOpen(true);
    const editorRoot = () => document.querySelector<HTMLElement>('.editor-wrap');
    void waitForTextRanges(
      editorRoot,
      needle,
      () => selectedRef.current === path && editorPathRef.current === path,
    ).then((ranges) => {
      const root = editorRoot();
      if (!root || !ranges.length || selectedRef.current !== path) return;
      findRangesRef.current = ranges;
      setFindMatchCount(ranges.length);
      applyTextHighlights(ranges, ranges[0]);
      revealTextRange(root, ranges[0]);
    });
  };

  const readNoteForSearch = async (path: string): Promise<string> => {
    if (path === selected && editorPathRef.current === path) return controller.content;
    const cached = contents[path] ?? demoContent[path];
    if (cached !== undefined) return cached;
    return root ? VaultService.read(root, path) : '';
  };

  const closeOpenTab = (path: string) => {
    const tabs = openTabsRef.current;
    if (tabs.length <= 1 || !path) return;
    const nextTabs = closeNoteTab(tabs, path);
    setOpenTabs(nextTabs);
    if (previewTab === path) setPreviewTab(null);
    if (path !== selected) return;
    const next = tabAfterClose(tabs, path);
    if (next) select(next, { recordTab: false });
    else setSelected('');
  };

  /** Folder target for new notes: explicit selection, else sibling of current note. */
  const noteTargetFolder = activeFolder || parentDir(selected);

  const finishNewNote = (relative: string, body?: string) => {
    if (onboarding && onboardingStep === 1) setWalkthroughNoteCreated(true);
    const title = relative.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled';
    const content = body ?? `# ${title}\n\n`;
    setContents((prev) => ({ ...prev, [relative]: content }));
    setOpenTabs((tabs) => openNoteInTabs(tabs, relative));
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
      '',
      canUseDiskVault(root)
        ? { extraAction: { label: 'Import PDF…', onClick: () => void importPdfFromSidebar() } }
        : {},
    );
    if (!name) return;
    const relative = joinNotePath(noteTargetFolder, name);
    if (!relative) return;

    if (canUseDiskVault(root)) {
      try {
        const created = await vault.create(relative);
        finishNewNote(created, onboarding && onboardingStep === 1 ? '' : undefined);
        if (onboarding && onboardingStep === 1) setOnboardingStep(2);
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

    createDemoNote(relative, onboarding && onboardingStep === 1 ? '' : undefined);
    if (onboarding && onboardingStep === 1) setOnboardingStep(2);
  };

  const importPdfFromSidebar = async () => {
    try {
      const imported = await importPdf();
      if (imported) setTreeFocus({ kind: 'file', path: imported });
    } catch (error) {
      console.error('Failed to import PDF', error);
      window.alert(error instanceof Error ? error.message : 'Could not import that PDF.');
    }
  };

  const createQuiz = () => {
    setGenerateQuizOpen(true);
  };

  const exportNotePdf = async (path: string) => {
    if (!root || exportingPdf || isPdfFileName(path)) return;
    setExportingPdf(true);
    try {
      if (path === selected && controller.isDirty) await controller.persistence.flush();
      const markdown = path === selected ? controller.content : await loadNoteBody(path);
      await VaultService.exportNotePdf(root, path, markdown, noteExportTitle(markdown, path));
    } catch (error) {
      console.error('PDF export failed', error);
      window.alert(error instanceof Error ? error.message : 'Could not export that note.');
    } finally {
      setExportingPdf(false);
    }
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

  /** Source text for quiz generation, fitted to `budget` characters. */
  const loadSourceText = async (path: string, pageRange: string, budget: number): Promise<string> => {
    if (!isPdfFileName(path)) return truncateNoteContext(await loadNoteBody(path), budget);
    if (!root) throw new Error('Open a vault folder to make quizzes from PDFs.');
    const { pages, totalPages } = await VaultService.extractPdfText(root, path);
    const wanted = parsePageRange(pageRange, totalPages).filter((n) => n <= pages.length);
    return buildPdfContext(cleanPdfPages(pages), wanted, budget);
  };

  const analyzeQuizSources = async (sourcePaths: string[], pageRanges: Record<string, string>): Promise<AutoQuizCounts> => {
    const perSource = Math.floor(QUIZ_CONTEXT_CHARS / sourcePaths.length) - 200;
    const chunks: string[] = [];
    for (const path of sourcePaths) {
      const body = await loadSourceText(path, pageRanges[path] ?? '', perSource);
      chunks.push(`### File: ${path}\n\n${body.trim()}`);
    }
    const response = await aiClient.chat({
      system: AUTO_QUIZ_ANALYSIS_SYSTEM,
      messages: [{
        role: 'user',
        content: `Analyze the selected source material and estimate its quiz composition. Return JSON only.\n\n${chunks.join('\n\n-----\n\n')}`,
      }],
      // Reasoning models otherwise spend a small budget thinking and return
      // finish_reason=length with an empty completion.
      maxTokens: 2048,
      reasoning: { enabled: false, effort: 'none' },
      operation: 'quiz_composition_analysis',
    });
    return parseAutoQuizCounts(response);
  };

  /** Import a PDF into the folder the user is working in and show it in the tree. */
  const importPdf = async (): Promise<string | null> => {
    if (!root) throw new Error('Open a vault folder to import PDFs.');
    const imported = await VaultService.importPdf(root, noteTargetFolder);
    if (imported) {
      vault.setPdfFiles((current) => (current.includes(imported) ? current : [...current, imported].sort()));
    }
    return imported;
  };

  const confirmGenerateQuiz = async (result: GenerateQuizDialogResult) => {
    if (quizJob.status === 'running') return;
    if (controller.isDirty) await controller.persistence.flush();

    const sourcePaths = result.sourcePaths.filter((path) => !isQuizPath(path));
    if (sourcePaths.length === 0) {
      window.alert('Select at least one source note.');
      return;
    }

    const primary = sourcePaths[0];
    const saveFolder = parentDir(primary) || activeFolder;
    const takenPaths = [...vault.files];
    let titled = nextQuizTitle(result.title, saveFolder, takenPaths);
    let relative = joinNotePath(saveFolder, titled);
    if (!relative) return;

    // Close dialog immediately — generation continues in the background.
    setGenerateQuizOpen(false);
    if (onboarding && onboardingStep === 4) setOnboardingStep(5);
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
      // Split the budget per source so a long first source can't crowd out the
      // rest; reserve room for each "### File:" header and separator.
      const perSource = Math.floor(QUIZ_CONTEXT_CHARS / sourcePaths.length) - 200;
      const chunks: string[] = [];
      for (const path of sourcePaths) {
        const body = await loadSourceText(path, result.pageRanges[path] ?? '', perSource);
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
        noteContext: truncateNoteContext(noteContext, QUIZ_CONTEXT_CHARS),
        source: primary,
        sources: sourcePaths,
        types,
        mcqCount: quizSettings.mcqCount,
        clozeCount: quizSettings.clozeCount,
        openCount: quizSettings.openCount,
        codeCount: quizSettings.codeCount + (sandboxReady ? 1 : 0),
        difficulty: quizSettings.difficulty,
        customRubric: quizSettings.customRubric.trim() || undefined,
        autoComposition: result.mode === 'auto',
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
      doc.source = primary;
      if (quizSettings.customRubric.trim()) {
        doc.rubric = quizSettings.customRubric.trim();
      }

      let createdPath = relative;
      if (canUseDiskVault(root)) {
        let created = '';
        let body = '';
        for (let attempt = 0; attempt < 50; attempt += 1) {
          doc.title = titled;
          body = quizDocumentToMarkdown(doc, titled);
          try {
            created = await vault.create(relative);
            break;
          } catch (error) {
            if (!isAlreadyExistsError(error) || attempt === 49) throw error;
            takenPaths.push(relative);
            titled = nextQuizTitle(result.title, saveFolder, takenPaths);
            relative = joinNotePath(saveFolder, titled);
            if (!relative) throw error;
          }
        }
        await vault.write(created, body);
        createdPath = created;
        setContents((prev) => ({ ...prev, [created]: body }));
        // Don't steal focus mid-edit — toast lets the user open it.
      } else {
        doc.title = titled;
        const body = quizDocumentToMarkdown(doc, titled);
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
      setQuizSourceScan((n) => n + 1);
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
              : 'Quiz generation failed. Check the Tutor AI settings / network and try again.',
        });
      }
    }
  };
  const openFromToast = async (path: string) => {
    if (controller.isDirty) await controller.persistence.flush();
    const body = await loadNoteBody(path);
    setContents((prev) => ({ ...prev, [path]: body }));
    setOpenTabs((tabs) => openNoteInTabs(tabs, path));
    setSelected(path);
    setTreeFocus({ kind: 'file', path });
    controller.loadContent(body);
  };

  const startReview = async (deck: Deck) => {
    if (controller.isDirty) await controller.persistence.flush();
    // Pick up edits to the open note that the debounce hasn't indexed yet.
    if (selected && editorPathRef.current === selected) reviewIndex.update(selected, controller.content);
    const cards = reviewIndex.all().filter(deckFilter(deck, reviewIndex));
    const session = new ReviewSession(cards, review.store, review.scheduler, review.settings, Date.now());
    setReviewRun({ id: Date.now(), session, deck, paused: false });
    setLayout((current) => ({ ...current, focusMode: false }));
  };

  /** Jump from a card to the note it was written in; the review waits in the tab bar. */
  const openCardSource = (card: ReviewCard) => {
    setReviewRun((current) => (current ? { ...current, paused: true } : current));
    if (card.source.path !== selected) select(card.source.path);
  };

  /** Rewrite a card in its note from the review screen, keeping its review history. */
  const editCard = async (card: ReviewCard, edit: CardEdit): Promise<string | null> => {
    const path = card.source.path;
    const isOpen = path === selected && editorPathRef.current === path;
    if (controller.isDirty) await controller.persistence.flush();
    let markdown: string;
    try {
      markdown = isOpen ? controller.content : canUseDiskVault(root) ? await VaultService.read(root, path) : await loadNoteBody(path);
    } catch {
      return 'Could not read the note.';
    }
    const result = applyCardEdit(markdown, card, edit);
    if (!result.ok) return result.error;
    if (canUseDiskVault(root)) {
      try {
        await VaultService.write(root, path, result.markdown);
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not save the card.';
      }
    }
    setContents((prev) => ({ ...prev, [path]: result.markdown }));
    if (isOpen) {
      controller.loadContent(result.markdown);
      controller.markSaved();
      setEditorRevision((n) => n + 1);
    }
    reviewIndex.update(path, result.markdown);
    const cards = reviewIndex.note(path)?.cards ?? [result.card];
    review.store.rekey(result.migrations, cards);
    reviewRun?.session.rekey(result.migrations, cards);
    return null;
  };

  /** Study Chat → note: at the caret (live editor) or appended to the end. */
  const insertFromChat = (markdown: string, target: ChatInsertTarget) => {
    const path = selected;
    const md = markdown.trim();
    if (!path || !md) return;
    const editor = editorRef.current;
    // An empty note has no caret to restore, so it takes the append path.
    if (target === 'cursor' && editor && controller.content.trim()) {
      editor.insertMarkdown(md);
      return;
    }
    const base = controller.content.replace(/\s+$/, '');
    const addition = preferOneLineDisplayMath(normalizePastedMathMarkdown(md));
    const next = base ? `${base}\n\n${addition}\n` : `${addition}\n`;
    controller.setContent(next);
    setContents((prev) => ({ ...prev, [path]: next }));
    setEditorRevision((n) => n + 1);
    requestAnimationFrame(() => {
      const wrap = document.querySelector<HTMLElement>('.editor-wrap');
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    });
  };

  const insertCardBlocks = async (blocks: string[]) => {
    const path = selected;
    if (!path || blocks.length === 0) return;
    const next = appendCardLines(controller.content, blocks);
    if (canUseDiskVault(root)) {
      try {
        await VaultService.write(root, path, next);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save the new cards.';
        window.alert(message);
        throw error instanceof Error ? error : new Error(message);
      }
    }
    setContents((prev) => ({ ...prev, [path]: next }));
    controller.loadContent(next);
    controller.markSaved();
    setEditorRevision((n) => n + 1);
    reviewIndex.update(path, next);
  };

  const openCreateCards = () => {
    if (!selected || isQuizPath(selected)) return;
    setCreateCardsOpen(true);
    setRightOpen(true);
    setLayout((current) => ({ ...current, focusMode: false }));
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
          setOpenTabs((tabs) => renamePathsInTabs(tabs, path, renamed));
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
      setOpenTabs((tabs) => renamePathsInTabs(tabs, path, target));
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
          if (selected === path) setSelected(renamed);
          setOpenTabs((tabs) => renamePathsInTabs(tabs, path, renamed));
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
        setOpenTabs((tabs) => renamePathsInTabs(tabs, path, renamed));
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
    setOpenTabs((tabs) => renamePathsInTabs(tabs, path, target));
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
      setOpenTabs((tabs) => tabs.filter((tab) => tab !== path && !tab.startsWith(`${path}/`)));
      if (selected === path || selected.startsWith(`${path}/`)) {
        const remaining = files.filter(
          (f) => f !== path && !f.startsWith(`${path}/`),
        );
        const next = remaining[0] ?? '';
        setSelected(next);
        if (next) setOpenTabs((tabs) => (tabs.length ? tabs : [next]));
      }
    } else {
      const tabs = openTabsRef.current;
      const nextTabs = closeNoteTab(tabs, path);
      if (selected === path) {
        const nextFromTabs = tabAfterClose(tabs, path);
        const remaining = files.filter((f) => f !== path);
        const next = nextFromTabs ?? remaining[0] ?? '';
        setSelected(next);
        setOpenTabs(next && !nextTabs.includes(next) ? openNoteInTabs(nextTabs, next) : nextTabs);
      } else {
        setOpenTabs(nextTabs);
      }
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
  const reviewDueCount = review.due.newCount + review.due.learning + review.due.review;
  const reviewing = Boolean(reviewRun && !reviewRun.paused);
  useEffect(() => {
    if (!findOpen) {
      findRangesRef.current = [];
      setFindMatchCount(0);
      clearTextHighlights();
      return;
    }
    const root = document.querySelector<HTMLElement>('.editor-wrap');
    const ranges = root ? findTextRanges(root, findQuery) : [];
    findRangesRef.current = ranges;
    setFindMatchCount(ranges.length);
    const activeIndex = ranges.length ? Math.min(findIndex, ranges.length - 1) : 0;
    if (activeIndex !== findIndex) setFindIndex(activeIndex);
    applyTextHighlights(ranges, ranges[activeIndex]);
    return () => clearTextHighlights();
  }, [findOpen, findQuery, findIndex, selected, controller.content]);
  const moveFindMatch = (direction: number) => {
    const ranges = findRangesRef.current;
    if (!ranges.length) return;
    const index = (findIndex + direction + ranges.length) % ranges.length;
    setFindIndex(index);
    applyTextHighlights(ranges, ranges[index]);
    const root = document.querySelector<HTMLElement>('.editor-wrap');
    if (root) revealTextRange(root, ranges[index]);
  };
  const revealCurrentFindMatch = () => {
    const ranges = findRangesRef.current;
    if (!ranges.length) return;
    const index = Math.min(findIndex, ranges.length - 1);
    applyTextHighlights(ranges, ranges[index]);
    const root = document.querySelector<HTMLElement>('.editor-wrap');
    if (root) revealTextRange(root, ranges[index]);
  };
  const shellClass = [
    'app-shell',
    layout.focusMode ? 'focus-mode' : '',
    !layout.focusMode && !layout.sidebarOpen ? 'sidebar-collapsed' : '',
    !layout.focusMode && !layout.rightOpen ? 'right-collapsed' : '',
    !layout.focusMode && layout.rightOpen && createCardsOpen ? 'create-cards-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <aside className="rail" aria-label="Primary">
        <div className="brand-rail-mark" title="Concrete">
          <BrandLogo logo={brandLogo} />
        </div>
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
          className={
            rail === 'review' && layout.sidebarOpen && !layout.focusMode
              ? 'rail-button rail-button-review active'
              : 'rail-button rail-button-review'
          }
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label={`Review${reviewDueCount ? ` (${reviewDueCount} waiting)` : ''}`}
          title="Review flashcards"
          aria-pressed={rail === 'review' && layout.sidebarOpen && !layout.focusMode}
          onClick={() => selectRail('review')}
        >
          <LayersIcon width={18} height={18} />
          {reviewDueCount > 0 ? (
            <span className="rail-badge">{reviewDueCount > 99 ? '99+' : reviewDueCount}</span>
          ) : null}
        </IconButton>
        <IconButton
          type="button"
          className="rail-button"
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Generate quiz"
          title="Generate quiz"
          data-tour="generate-quiz"
          disabled={!selected || reviewing || isQuizPath(selected) || generatingQuiz}
          onClick={createQuiz}
        >
          <ClipboardIcon width={18} height={18} />
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
            <ExitFullScreenIcon width={18} height={18} />
          ) : (
            <EnterFullScreenIcon width={18} height={18} />
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
        {rail === 'review' ? (
          <ReviewSidebar
            system={review}
            onStart={(deck) => void startReview(deck)}
            onClose={() => setSidebarOpen(false)}
          />
        ) : rail === 'tags' ? (
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
                  aria-label="Search notes"
                  title="Search notes (⌘P)"
                  onClick={() => setOverlay('search')}
                >
                  <MagnifyingGlassIcon width={16} height={16} />
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
                  <PlusCircledIcon width={16} height={16} />
                </IconButton>
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label="New folder"
                  onClick={createFolder}
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
              quizStatus={quizStatus}
              onSelectFile={select}
              onSelectFolder={(path) => {
                setActiveFolder(path);
                setTreeFocus(path ? { kind: 'folder', path } : null);
              }}
              onRename={renameTreeItem}
              onDelete={(path, kind) => void deleteTreeItem({ path, kind })}
              onExportPdf={window.vault?.exportNotePdf ? (path) => void exportNotePdf(path) : undefined}
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
                <ChevronLeftIcon width={16} height={16} />
              ) : (
                <ChevronRightIcon width={16} height={16} />
              )}
            </IconButton>
          )}
          <OpenTabsBar
            tabs={openTabs}
            selected={selected}
            previewTab={previewTab}
            dirtyPath={!saved ? selected : null}
            reviewLabel={reviewRun?.deck.label ?? null}
            reviewing={reviewing}
            onSelect={(path) => select(path, { preview: previewTab === path })}
            onPin={(path) => select(path)}
            onRename={(path, name) => void renameTreeItem(path, 'file', name)}
            onClose={closeOpenTab}
            onResumeReview={() =>
              setReviewRun((current) => (current ? { ...current, paused: false } : current))
            }
            onEndReview={() => setReviewRun(null)}
          />
          <div className="tab-spacer" />
          {!reviewing && !isQuizPath(selected) && noteTags.length > 0 && (
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
              {layout.focusMode ? <ExitFullScreenIcon width={16} height={16} /> : <EnterFullScreenIcon width={16} height={16} />}
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
                  <ChevronRightIcon width={16} height={16} />
                ) : (
                  <ChevronLeftIcon width={16} height={16} />
                )}
              </IconButton>
            )}
            {!reviewing && isQuizPath(selected) ? <QuizReviewToggle system={review} path={selected} /> : null}
            {!reviewing && !isQuizPath(selected) && selected ? (
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
        <div className="editor-split" ref={editorSplitRef}>
        <div className="editor-stage">
        <div className={`editor-wrap${isPdfFileName(selected) ? ' pdf-editor-wrap' : ''}`}>
          {findOpen ? (
            <div className="find-bar" role="search">
              <input
                ref={findInputRef}
                value={findQuery}
                placeholder="Find in file"
                aria-label="Find in current file"
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  setFindIndex(0);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFindOpen(false);
                  } else if (event.key === 'Tab') {
                    event.preventDefault();
                    revealCurrentFindMatch();
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    moveFindMatch(event.shiftKey ? -1 : 1);
                  }
                }}
              />
              <span>{findMatchCount ? `${findIndex + 1} of ${findMatchCount}` : 'No matches'}</span>
              <button
                type="button"
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                onClick={() => {
                  moveFindMatch(-1);
                }}
              >
                <ChevronUpIcon width={14} height={14} />
              </button>
              <button
                type="button"
                aria-label="Next match"
                title="Next match (Enter)"
                onClick={() => {
                  moveFindMatch(1);
                }}
              >
                <ChevronDownIcon width={14} height={14} />
              </button>
              <button type="button" onClick={() => setFindOpen(false)} aria-label="Close find">×</button>
            </div>
          ) : null}
          {reviewRun && !reviewRun.paused ? (
            <ReviewView
              key={reviewRun.id}
              session={reviewRun.session}
              deckLabel={reviewRun.deck.label}
              store={review.store}
              scheduler={review.scheduler}
              typeCloze={review.settings.typeCloze}
              onExit={() => setReviewRun(null)}
              onOpenSource={openCardSource}
              onEditCard={editCard}
              quizQuestionFor={(card) => {
                const markdown = reviewIndex.note(card.source.path)?.quizMarkdown;
                return markdown ? (quizQuestionForCard(markdown, card)?.question ?? null) : null;
              }}
            />
          ) : isPdfFileName(selected) ? (
            <PdfView path={selected} vaultRoot={root} />
          ) : isQuizPath(selected) ? (
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
            <>
              <WysiwygEditor
                ref={editorRef}
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
              <QuizFromNotePrompt
                markdown={controller.content}
                alreadyQuizzed={quizzedSources.has(notePathKey(selected))}
                onGenerate={createQuiz}
              />
            </>
          )}
        </div>
        <button
          type="button"
          className={aiChatOpen ? 'study-chat-launcher active' : 'study-chat-launcher'}
          aria-label="Study chat (⌘J)"
          title="Study chat (⌘J)"
          aria-pressed={aiChatOpen}
          onClick={() => selectRail('ai')}
        >
          <BrandLogo logo="triple-c" />
        </button>
        </div>
        {aiChatOpen ? (
          <>
            <div
              className="study-chat-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat"
              onPointerDown={startChatResize}
              onDoubleClick={() => setChatWidth(STUDY_CHAT_DEFAULT_WIDTH)}
            />
            <div className="study-chat-column" style={{ width: chatWidth }}>
              <Suspense fallback={null}>
                <StudyChatPane
                  client={aiClient}
                  notePath={selected}
                  noteContent={isPdfFileName(selected) ? '' : controller.content}
                  vaultRoot={root}
                  agentProviderId={agentProviderId}
                  canInsert={Boolean(selected) && !isQuizPath(selected) && !isPdfFileName(selected) && !reviewing}
                  onInsert={insertFromChat}
                  onClose={() => setAiChatOpen(false)}
                  seedPrompt={aiSeedPrompt}
                  onSeedConsumed={() => setAiSeedPrompt(null)}
                  pendingQuote={chatQuote}
                  onQuoteConsumed={() => setChatQuote(null)}
                  focusToken={chatFocusToken}
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
              </Suspense>
            </div>
          </>
        ) : null}
        </div>
        <footer className="statusbar">
          <span>{controller.content.length} characters</span>
          <span>•</span>
          <span>{root ? 'Saved to disk' : 'In-memory demo'}</span>
          <span className="status-spacer" />
          {layout.focusMode ? <span>Focus mode · Esc to exit</span> : <span>{saved ? 'Saved' : 'Editing'}</span>}
        </footer>
      </main>

      <aside className="right-panel" aria-hidden={!layout.rightOpen || layout.focusMode}>
        {createCardsOpen && selected && !isQuizPath(selected) ? (
          <CreateCardsPanel
            client={aiClient}
            path={selected}
            content={controller.content}
            onInsert={insertCardBlocks}
            onClose={() => setCreateCardsOpen(false)}
          />
        ) : (
          <>
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
            {selected && !isQuizPath(selected) && !isPdfFileName(selected) ? (
              <div className="panel-section">
                <NoteCardsPanel
                  system={review}
                  path={selected}
                  onReview={() => void startReview({ kind: 'note', label: noteTitle(selected), path: selected })}
                  onCreate={openCreateCards}
                />
              </div>
            ) : null}
            <div className="panel-section">
              <ProgressPanel store={quizHistory} folder={parentDir(selected)} />
            </div>
          </>
        )}
      </aside>

      {generateQuizOpen && (
        <Suspense fallback={null}>
          <GenerateQuizDialog
            files={files}
            pdfFiles={pdfFiles}
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
            onAnalyzeAuto={analyzeQuizSources}
          />
        </Suspense>
      )}

      <div className="mv-toast-stack">
      {gradingJobs
        .filter((job) => job.path !== selected && !job.toastDismissed && (job.status === 'grading' || job.unseen))
        .map((job) => (
          <div key={job.path} className={`mv-toast mv-toast-${job.status === 'graded' ? 'done' : job.status}`} role="status" aria-live="polite">
            {job.status === 'grading' ? (
              <UpdateIcon width={16} height={16} className="mv-toast-spin" aria-hidden />
            ) : job.status === 'graded' ? (
              <ClipboardIcon width={16} height={16} aria-hidden />
            ) : null}
            <div className="mv-toast-body">
              <strong>
                {job.status === 'grading'
                  ? 'Grading quiz'
                  : job.status === 'graded'
                    ? `Quiz graded · ${job.report?.percent ?? 0}%`
                    : 'Grading failed'}
              </strong>
              <span>{job.status === 'error' ? job.error : job.title}</span>
            </div>
            {job.status !== 'grading' ? (
              <Button size="1" highContrast onClick={() => void openFromToast(job.path)}>
                {job.status === 'graded' ? 'View' : 'Open'}
              </Button>
            ) : null}
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Dismiss"
              onClick={() => quizGradingJobs.dismissToast(job.path)}
            >
              <Cross1Icon width={12} height={12} />
            </IconButton>
          </div>
        ))}
      {quizJob.status !== 'idle' && (
        <div
          className={`mv-toast mv-toast-${quizJob.status}`}
          role="status"
          aria-live="polite"
        >
          {quizJob.status === 'running' ? (
            <>
              <UpdateIcon width={16} height={16} className="mv-toast-spin" aria-hidden />
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
                  void openFromToast(path);
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
      </div>

      {onboarding && (
        <div
          className={`mv-overlay mv-onboarding-overlay ${
            onboardingStep === 2 ||
            onboardingStep === 1 ||
            (onboardingStep === 3 && aiChatOpen) ||
            onboardingStep === 4 ||
            onboardingStep === 5
              ? 'mv-onboarding-interactive'
              : ''
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Concrete getting started walkthrough"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault();
          }}
        >
          <ProductTour
            stepIndex={onboardingStep}
            canAdvance={walkthroughNoteCreated}
            onStepIndexChange={(nextStep) => {
              if (onboardingStep === 3 && nextStep === 4) setAiChatOpen(false);
              if (onboardingStep === 5 && nextStep === 6) {
                setRail('files');
                setLayout((current) => ({ ...current, sidebarOpen: true, focusMode: false }));
              }
              setOnboardingStep(nextStep);
            }}
            excludeWelcome={selected.toLowerCase().split('/').pop() === 'welcome.md'}
            seededReviewCards={seededReviewCards}
            targetOverride={
              onboardingStep === 3 && aiChatOpen
                ? '.study-chat-column'
                : onboardingStep === 4 && generateQuizOpen
                  ? '.generate-quiz-panel'
                  : onboardingStep === 5 && rail === 'review' && layout.sidebarOpen
                    ? '.srs-sidebar'
                    : undefined
            }
            onFinished={() => {
              localStorage.setItem('mv:onboarding-complete', '1');
              setOnboarding(false);
              setOnboardingStep(0);
            }}
          />
        </div>
      )}

      {overlay === 'search' && (
        <SearchPalette
          index={searchIndex}
          recentPaths={openTabs.filter((path) => path && path !== selected).reverse()}
          readNote={readNoteForSearch}
          onOpen={openSearchResult}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === 'settings' && (
        <Suspense fallback={<div className="mv-settings-panel mv-settings-page" />}>
          <SettingsPanel
            store={settingsStore}
            vaultRoot={root}
            onImportObsidian={() => { void importObsidianVault().then(() => setOverlay(null)); }}
            onImportNotion={() => { void importNotionExport().then(() => setOverlay(null)); }}
            onReplayOnboarding={() => {
              setOverlay(null);
              setOnboardingStep(0);
              setWalkthroughNoteCreated(false);
              setOnboarding(true);
            }}
            onClose={() => setOverlay(null)}
          />
        </Suspense>
      )}

    </div>
  );
}
