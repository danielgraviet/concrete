/**
 * Mobile shell for phone browsers (app.useconcrete.app).
 *
 * A dedicated app-like UI — bottom tab bar, full-screen views — that reuses
 * the domain layer untouched: the cloud vault via `useVault`, flashcards via
 * `useReviewSystem`/`ReviewSession`, quizzes via `QuizShell`, and the home
 * screen with streak/rank via `VaultHome`. Chosen once at startup by
 * `isPhoneScreen()` in `src/web/startWeb.tsx`; tablets and desktop windows
 * keep the desktop `App`.
 *
 * v1 scope: streaks, light notes, flashcard review, taking quizzes.
 * Desktop-only for now: quiz generation, study chat, PDFs/slide decks,
 * Obsidian/Notion import, the product tour.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Button, IconButton } from '@radix-ui/themes';
import {
  ChevronLeftIcon,
  ClipboardIcon,
  Cross1Icon,
  FileTextIcon,
  GearIcon,
  HomeIcon,
  LayersIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Share1Icon,
  UpdateIcon,
} from '@radix-ui/react-icons';
import { WysiwygEditor, useEditorController, type WysiwygEditorHandle } from '../editor';
import { registerPageExitFlush } from '../editor/pageExitFlush';
import { splitFrontmatter } from '../meta/frontmatter';
import {
  ALL_DECK,
  applyCardDelete,
  applyCardEdit,
  cardsFromNote,
  deckFilter,
  linkedCardEdit,
  pairCards,
  quizCardForQuestion,
  quizQuestionForCard,
  ReviewSession,
  ReviewSidebar,
  ReviewView,
  useReviewSystem,
  type CardEdit,
  type Deck,
  type ReviewCard,
} from '../learn';
import {
  askText,
  canUseDiskVault,
  ensureFolderAncestors,
  isDocumentFileName,
  isHiddenVaultFile,
  joinNotePath,
  noteTitle,
  parentDir,
  useVault,
  VaultService,
} from '../vault';
import { VaultHome } from '../vault/VaultHome';
import { SearchIndex, SearchPalette } from '../search';
import { aiClient } from '../ai';
import { resolveAiProvider } from '../ai/resolveAiProvider';
import { quizGradingJobs, QuizHistoryStore, QuizShell } from '../quiz';
import { DailyActivityStore } from '../quiz/dailyActivity';
import { isQuizPath } from '../quiz/paths';
import { useProgressSync } from '../quiz/useProgressSync';
import { settingsStore } from '../settings';
import { BrandLogo } from '../branding/BrandLogo';
import { getBackend } from '../backend';
import type { RequestShare } from '../web/share/types';
import { groupNotes } from './notes';
import './mobile.css';

const SettingsPanel = lazy(() =>
  import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

type MobileTab = 'home' | 'notes' | 'review' | 'quizzes';

const SAMPLE_CARDS_NOTE =
  '# Concrete Basics\n\nA few sample cards to try in Review. Edit or delete this note whenever you like.\n\nWhat kind of files does Concrete use? :: Plain Markdown files.\nWhere is the default vault? :: Documents/Concrete.\nHow do you link notes? :: Type [[Note title]].\n';

function readRecentFiles(vaultRoot: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`mv:recent-files:${vaultRoot}`) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

/** Quiz title without the "Quiz " prefix the generator adds. */
function quizDisplayTitle(path: string): string {
  return noteTitle(path).replace(/^Quiz\s+/i, '');
}

export default function MobileApp({ accountSlot, onShare }: { accountSlot?: ReactNode; onShare?: RequestShare } = {}) {
  const vault = useVault(['Welcome.md'], []);
  const [restoring, setRestoring] = useState(true);
  const [contents, setContents] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<MobileTab>('home');
  const [openNotePath, setOpenNotePath] = useState('');
  const [openQuizPath, setOpenQuizPath] = useState('');
  const [quizMarkdown, setQuizMarkdown] = useState('');
  /** True once the open quiz's body has been read; QuizShell waits on it. */
  const [quizLoaded, setQuizLoaded] = useState(false);
  const [reviewRun, setReviewRun] = useState<{ id: number; session: ReviewSession; deck: Deck } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<{ vaultRoot: string; paths: string[] } | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [editorRevision, setEditorRevision] = useState(0);

  const root = vault.root;
  const files = vault.files;
  const pinVault = root ?? '';

  // The editor's note, tracked before autosave uses it (async like the editor).
  const editorPathRef = useRef('');
  const rootRef = useRef(root);
  rootRef.current = root;
  const openNotePathRef = useRef(openNotePath);
  openNotePathRef.current = openNotePath;
  const openQuizPathRef = useRef(openQuizPath);
  openQuizPathRef.current = openQuizPath;
  const quizMarkdownRef = useRef(quizMarkdown);
  quizMarkdownRef.current = quizMarkdown;

  const editorRef = useRef<WysiwygEditorHandle>(null);

  // --- Stores shared with the desktop shell ---------------------------------
  const review = useReviewSystem(root);
  const reviewIndex = review.index;
  const quizHistory = useMemo(() => new QuizHistoryStore(root ?? ''), [root]);
  const dailyActivity = useMemo(() => new DailyActivityStore(root ?? ''), [root]);
  const searchIndex = useMemo(() => new SearchIndex(), [root]);

  // Opening the app counts as an active day (streaks); interactions catch
  // days the tab stays open across midnight. The store dedupes per local day.
  useEffect(() => {
    const recordActivity = () => {
      if (document.visibilityState === 'visible') dailyActivity.recordToday();
    };
    recordActivity();
    document.addEventListener('pointerdown', recordActivity, { passive: true });
    document.addEventListener('keydown', recordActivity);
    document.addEventListener('visibilitychange', recordActivity);
    return () => {
      document.removeEventListener('pointerdown', recordActivity);
      document.removeEventListener('keydown', recordActivity);
      document.removeEventListener('visibilitychange', recordActivity);
    };
  }, [dailyActivity]);

  useProgressSync({
    root,
    history: quizHistory,
    activity: dailyActivity,
    recent: recentFiles?.vaultRoot === pinVault ? recentFiles.paths : readRecentFiles(pinVault),
    setRecent: (paths) => setRecentFiles({ vaultRoot: pinVault, paths }),
  });

  useEffect(() => {
    const settings = settingsStore.hydrate();
    aiClient.setProvider(resolveAiProvider(settings));
    return settingsStore.subscribe((next) => aiClient.setProvider(resolveAiProvider(next)));
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(typeof navigator === 'undefined' || navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // --- Note editor (same controller/autosave pattern as the desktop shell) --
  const contentRef = useRef('');
  const markSavedRef = useRef<(content?: string) => void>(() => {});

  const controller = useEditorController({
    initialContent: '',
    autosaveMs: settingsStore.get().autosaveMs || 800,
    saveFn: async () => {
      const path = openNotePathRef.current;
      const vaultRoot = rootRef.current;
      const markdown = contentRef.current;
      if (!vaultRoot || !path || isDocumentFileName(path)) return;
      // The editor still holds another note while this one is loading.
      if (editorPathRef.current !== path) return;
      await VaultService.write(vaultRoot, path, markdown);
      setContents((prev) => ({ ...prev, [path]: markdown }));
      markSavedRef.current(markdown);
    },
  });

  contentRef.current = controller.content;
  markSavedRef.current = controller.markSaved;

  // Closing the tab must hand the edit to the vault synchronously (the web
  // journal picks it up from there).
  const persistence = controller.persistence;
  useEffect(() => registerPageExitFlush(() => void persistence.flush()), [persistence]);

  // Load the open note from the vault.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!openNotePath || isDocumentFileName(openNotePath)) {
        controller.loadContent('');
        return;
      }
      if (root) {
        try {
          const text = await VaultService.read(root, openNotePath);
          if (cancelled) return;
          setContents((prev) => ({ ...prev, [openNotePath]: text }));
          editorPathRef.current = openNotePath;
          controller.loadContent(text);
          setEditorRevision((n) => n + 1);
          return;
        } catch {
          /* fall through to cache */
        }
      }
      const fallback = contents[openNotePath] ?? '';
      editorPathRef.current = openNotePath;
      controller.loadContent(fallback);
      setEditorRevision((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on note/vault change
  }, [root, openNotePath]);

  // Warm the card + search indexes: read every note once the vault restores.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    void (async () => {
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
        path === openNotePathRef.current && editorPathRef.current === path && contentRef.current
          ? ([path, contentRef.current] as const)
          : ([path, text] as const),
      );
      reviewIndex.replaceAll(indexed);
      searchIndex.replaceAll(indexed);
      setContents((prev) => {
        const next = { ...prev };
        for (const [path, text] of indexed) {
          if (path === openNotePathRef.current && editorPathRef.current === path && contentRef.current) {
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
  }, [root, files, reviewIndex, searchIndex]);

  // Demo mode has no disk to scan; index the in-memory notes instead.
  useEffect(() => {
    if (root) return;
    const entries = files.map((path) => [path, contents[path] ?? ''] as const);
    reviewIndex.replaceAll(entries);
    searchIndex.replaceAll(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when the file list changes
  }, [root, files, reviewIndex, searchIndex]);

  // Cards and search terms typed into the open note show up as you write.
  useEffect(() => {
    if (!openNotePath || editorPathRef.current !== openNotePath) return;
    const path = openNotePath;
    const text = controller.content;
    const timer = window.setTimeout(() => {
      reviewIndex.update(path, text);
      searchIndex.update(path, text);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce per keystroke
  }, [openNotePath, controller.content, reviewIndex, searchIndex]);

  // --- Vault restore + first-run seed ---------------------------------------
  useEffect(() => {
    if (vault.root) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    const firstRun = !localStorage.getItem('mv:onboarding-complete');
    const restore = () => {
      const opening = getBackend().vault?.restore ? vault.restore() : Promise.resolve(null);
      void opening.then(async (result) => {
        if (cancelled) return;
        if (!result) {
          setRestoring(false);
          return;
        }
        if (firstRun) {
          // Give Review something to show before the user has written cards.
          try {
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
              const created = await vault.create(sampleName);
              await VaultService.write(result.root, created, SAMPLE_CARDS_NOTE);
            }
          } catch (error) {
            console.warn('Could not add sample review cards', error);
          }
          // Mobile has no product tour; mark first run done so later visits
          // (also on desktop) restore instead of reseeding.
          if (!cancelled) localStorage.setItem('mv:onboarding-complete', '1');
        }
        if (cancelled) return;
        setRestoring(false);
      }).catch((error: unknown) => {
        console.error('Vault restore failed', error);
        if (!cancelled) setRestoring(false);
      });
    };
    const idleId = window.setTimeout(restore, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(idleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once when the vault API is ready
  }, []);

  // A different vault means different cards; drop any review in progress.
  useEffect(() => setReviewRun(null), [root]);

  // --- Recents ---------------------------------------------------------------
  const pushRecent = (path: string) => {
    setRecentFiles((current) => {
      const paths = current?.vaultRoot === pinVault ? current.paths : readRecentFiles(pinVault);
      if (paths[0] === path) return current?.vaultRoot === pinVault ? current : { vaultRoot: pinVault, paths };
      return { vaultRoot: pinVault, paths: [path, ...paths.filter((p) => p !== path)].slice(0, 50) };
    });
  };

  useEffect(() => {
    if (!recentFiles) return;
    try {
      localStorage.setItem(`mv:recent-files:${recentFiles.vaultRoot}`, JSON.stringify(recentFiles.paths));
    } catch {
      // Recents still work for this session.
    }
  }, [recentFiles]);

  // --- Opening things --------------------------------------------------------
  /** Persist any pending quiz-markdown edit before the quiz view goes away. */
  const flushOpenQuiz = async () => {
    const path = openQuizPathRef.current;
    const body = quizMarkdownRef.current;
    if (!root || !path || !body) return;
    try {
      await VaultService.write(root, path, body);
      setContents((prev) => ({ ...prev, [path]: body }));
    } catch {
      // onBlur saving retries; a failed flush shows up on next open.
    }
  };

  const openNote = async (path: string) => {
    if (controller.isDirty) await controller.persistence.flush();
    await flushOpenQuiz();
    setTab('notes');
    setOpenQuizPath('');
    setOpenNotePath(path);
    pushRecent(path);
  };

  const closeNote = async () => {
    if (controller.isDirty) await controller.persistence.flush();
    setOpenNotePath('');
  };

  const openQuiz = async (path: string) => {
    if (controller.isDirty) await controller.persistence.flush();
    await flushOpenQuiz();
    setTab('quizzes');
    setOpenNotePath('');
    setOpenQuizPath(path);
    pushRecent(path);
  };

  const closeQuiz = async () => {
    await flushOpenQuiz();
    setOpenQuizPath('');
  };

  // Quiz body for the open quiz.
  useEffect(() => {
    if (!openQuizPath) {
      setQuizMarkdown('');
      setQuizLoaded(false);
      return;
    }
    let cancelled = false;
    setQuizLoaded(false);
    void (async () => {
      const cached = contents[openQuizPath];
      const body =
        cached !== undefined
          ? cached
          : canUseDiskVault(root)
            ? await VaultService.read(root, openQuizPath).catch(() => '')
            : '';
      if (cancelled) return;
      setQuizMarkdown(body);
      setQuizLoaded(true);
      setContents((prev) => ({ ...prev, [openQuizPath]: body }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load per quiz/vault change
  }, [root, openQuizPath]);

  /** Route a tapped path (recents, search, home) by kind. */
  const openPath = (path: string) => (isQuizPath(path) ? openQuiz(path) : openNote(path));

  const readNoteForSearch = async (path: string): Promise<string> => {
    if (path === openNotePath && editorPathRef.current === path) return controller.content;
    const cached = contents[path];
    if (cached !== undefined) return cached;
    return canUseDiskVault(root) ? VaultService.read(root, path) : '';
  };

  // --- New note ---------------------------------------------------------------
  const createNote = async () => {
    if (controller.isDirty) await controller.persistence.flush();
    const name = await askText('New note name', '');
    if (!name) return;
    const relative = joinNotePath('', name);
    if (!relative) return;
    const title = relative.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled';
    const body = `# ${title}\n\n`;

    if (canUseDiskVault(root)) {
      try {
        const created = await vault.create(relative);
        await VaultService.write(root, created, body);
        setContents((prev) => ({ ...prev, [created]: body }));
        setOpenQuizPath('');
        setOpenNotePath(created);
        setTab('notes');
        editorPathRef.current = created;
        controller.loadContent(body);
        setEditorRevision((n) => n + 1);
        pushRecent(created);
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : 'Could not create that note. Try a simpler name.',
        );
      }
      return;
    }

    // Demo mode: keep the tree usable in memory.
    vault.setFiles((current) =>
      current.includes(relative)
        ? current
        : [...current, relative].sort((a, b) => a.localeCompare(b)),
    );
    setContents((prev) => ({ ...prev, [relative]: body }));
    setOpenNotePath(relative);
    setTab('notes');
    editorPathRef.current = relative;
    controller.loadContent(body);
    setEditorRevision((n) => n + 1);
  };

  // --- Flashcard review --------------------------------------------------------
  const startReview = async (deck: Deck) => {
    if (controller.isDirty) await controller.persistence.flush();
    // Pick up edits to the open note that the debounce hasn't indexed yet.
    if (openNotePath && editorPathRef.current === openNotePath) {
      reviewIndex.update(openNotePath, controller.content);
    }
    const cards = reviewIndex.all().filter(deckFilter(deck));
    const session = new ReviewSession(cards, review.store, review.scheduler, review.settings, Date.now());
    setReviewRun({ id: Date.now(), session, deck });
    setTab('review');
  };

  /** Jump from a card to the note it was written in; the review resumes when
   *  the Review tab (or its badge) is tapped again. */
  const openCardSource = (card: ReviewCard) => {
    if (!card.source.path) return;
    void openNote(card.source.path);
  };

  /** Cards with this path, with their vault-wide ids (as stored in history). */
  const vaultCardsAt = (path: string) => reviewIndex.all().filter((c) => c.source.path === path);

  /** Edit a card kept in `.vault/cards.json`; history follows it to its new id. */
  const editLinkedCard = async (card: ReviewCard, edit: CardEdit): Promise<string | null> => {
    const uid = card.source.uid;
    const stored = uid ? review.linked.get(uid) : undefined;
    if (!uid || !stored) return 'That card no longer exists.';
    const result = linkedCardEdit(card, stored, edit);
    if (!result.ok) return result.error;
    const before = vaultCardsAt(stored.path).filter((c) => c.source.uid === uid);
    try {
      await review.linked.update(uid, result.input);
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not save the card.';
    }
    const cards = vaultCardsAt(stored.path);
    const migrations = pairCards(before, cards.filter((c) => c.source.uid === uid));
    review.store.rekey(migrations, cards);
    reviewRun?.session.rekey(migrations, cards);
    return null;
  };

  /** Rewrite a card in its note from the review screen, keeping its history. */
  const editCard = async (card: ReviewCard, edit: CardEdit): Promise<string | null> => {
    if (card.source.origin === 'linked') return editLinkedCard(card, edit);
    const path = card.source.path;
    const isOpen = path === openNotePath && editorPathRef.current === path;
    if (controller.isDirty) await controller.persistence.flush();
    let markdown: string;
    try {
      markdown = isOpen
        ? controller.content
        : canUseDiskVault(root)
          ? await VaultService.read(root, path)
          : (contents[path] ?? '');
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

  const deleteCard = async (card: ReviewCard): Promise<string | null> => {
    if (card.source.origin === 'linked') {
      try {
        if (card.source.uid) await review.linked.remove([card.source.uid]);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not delete the card.';
      }
    }
    const path = card.source.path;
    const isOpen = path === openNotePath && editorPathRef.current === path;
    if (controller.isDirty) await controller.persistence.flush();
    let markdown: string;
    try {
      markdown = isOpen
        ? controller.content
        : canUseDiskVault(root)
          ? await VaultService.read(root, path)
          : (contents[path] ?? '');
    } catch {
      return 'Could not read the note.';
    }
    const result = applyCardDelete(markdown, card);
    if (!result.ok) return result.error;
    if (canUseDiskVault(root)) {
      try {
        await VaultService.write(root, path, result.markdown);
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not delete the card.';
      }
    }
    setContents((prev) => ({ ...prev, [path]: result.markdown }));
    if (isOpen) {
      controller.loadContent(result.markdown);
      controller.markSaved();
      setEditorRevision((n) => n + 1);
    }
    reviewIndex.update(path, result.markdown);
    return null;
  };

  const quizQuestionFor = (card: ReviewCard) => {
    const markdown = reviewIndex.note(card.source.path)?.quizMarkdown;
    return markdown ? (quizQuestionForCard(markdown, card)?.question ?? null) : null;
  };

  // --- Quiz-question ↔ flashcard bridge (same as the desktop shell) ---------
  const quizQuestionCard = (path: string, questionId: string) => {
    const note = reviewIndex.note(path);
    return note?.quizMarkdown
      ? quizCardForQuestion(note.cards, note.quizMarkdown, questionId)
      : undefined;
  };
  const addQuizQuestionToFlashcards = (path: string, questionId: string) => {
    const card = quizQuestionCard(path, questionId);
    if (!card || !review.store.isLoaded) return false;
    review.store.enroll([card], Date.now());
    return true;
  };
  const isQuizQuestionInFlashcards = (path: string, questionId: string) => {
    const card = quizQuestionCard(path, questionId);
    return Boolean(card && review.store.isActive(card));
  };

  // --- Grading toasts ---------------------------------------------------------
  const gradingJobs = useSyncExternalStore(quizGradingJobs.subscribe, quizGradingJobs.getAll);

  // --- Derived lists ------------------------------------------------------------
  const noteFiles = useMemo(
    () => files.filter((path) => !isQuizPath(path)).sort((a, b) => a.localeCompare(b)),
    [files],
  );
  const noteGroups = useMemo(() => groupNotes(noteFiles), [noteFiles]);
  const quizFiles = useMemo(() => files.filter(isQuizPath).sort((a, b) => a.localeCompare(b)), [files]);
  const recentPaths = recentFiles?.vaultRoot === pinVault ? recentFiles.paths : readRecentFiles(pinVault);
  const saved = !controller.isDirty;
  const reviewDueCount = review.due.newCount + review.due.learning + review.due.review;

  // ------------------------------------------------------------------ render --
  if (restoring && !root) {
    return (
      <div className="mobile-app mobile-splash" aria-busy="true">
        <BrandLogo logo="triple-c" />
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="mobile-header-brand">
          <BrandLogo logo="triple-c" />
          <span>Concrete</span>
        </div>
        {!isOnline ? <span className="mobile-offline" role="status">✈ Offline</span> : null}
        <div className="mobile-header-spacer" />
        <IconButton
          type="button"
          size="2"
          variant="ghost"
          color="gray"
          highContrast
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon width={18} height={18} />
        </IconButton>
        {accountSlot ? <div className="mobile-account">{accountSlot}</div> : null}
      </header>

      <main className="mobile-content">
        {tab === 'home' ? (
          <div className="mobile-scroll">
            <VaultHome
              recentPaths={recentPaths}
              availablePaths={new Set(files)}
              historyStore={quizHistory}
              activityStore={dailyActivity}
              vaultRoot={pinVault}
              onOpen={(path) => void openPath(path)}
              onCreate={() => void createNote()}
              onSearch={() => setSearchOpen(true)}
            />
          </div>
        ) : null}

        {tab === 'notes' ? (
          openNotePath ? (
            <div className="mobile-subview">
              <div className="mobile-subheader">
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label="Back to notes"
                  onClick={() => void closeNote()}
                >
                  <ChevronLeftIcon width={18} height={18} />
                </IconButton>
                <div className="mobile-subheader-title">
                  <strong>{noteTitle(openNotePath)}</strong>
                  {parentDir(openNotePath) ? <small>{parentDir(openNotePath)}</small> : null}
                </div>
                {onShare && /\.md$/i.test(openNotePath) ? (
                  <IconButton
                    type="button"
                    size="2"
                    variant="ghost"
                    color="gray"
                    highContrast
                    aria-label="Share note"
                    onClick={() => void onShare({ kind: 'note', path: openNotePath })}
                  >
                    <Share1Icon width={16} height={16} />
                  </IconButton>
                ) : null}
                <span className={`sync-dot ${saved ? '' : 'unsaved'}`} title={saved ? 'Saved' : 'Editing'} />
              </div>
              <div className="mobile-editor editor-wrap">
                <WysiwygEditor
                  ref={editorRef}
                  className="wysiwyg"
                  documentId={openNotePath}
                  vaultRoot={root ?? undefined}
                  contentRevision={editorRevision}
                  markdown={splitFrontmatter(controller.content).body}
                  onChange={(value) => {
                    const current = controller.content;
                    const parsed = splitFrontmatter(current);
                    const metadata = parsed.raw
                      ? current.slice(0, current.length - parsed.body.length)
                      : '';
                    const updated = metadata + value;
                    controller.setContent(updated);
                    setContents((prev) => ({ ...prev, [openNotePath]: updated }));
                  }}
                  onBlur={() => void controller.persistence.flush()}
                />
              </div>
            </div>
          ) : (
            <div className="mobile-scroll">
              <div className="mobile-list-head">
                <h1>Notes</h1>
                <Button size="2" highContrast onClick={() => void createNote()}>
                  <PlusIcon /> New note
                </Button>
              </div>
              <div className="mobile-list-actions">
                <button type="button" className="mobile-search-bar" onClick={() => setSearchOpen(true)}>
                  <MagnifyingGlassIcon width={14} height={14} />
                  <span>Search notes</span>
                </button>
              </div>
              {noteGroups.rootFiles.length || noteGroups.folders.length ? (
                <div className="mobile-list">
                  {noteGroups.rootFiles.length ? (
                    <NoteRows paths={noteGroups.rootFiles} onOpen={(path) => void openNote(path)} />
                  ) : null}
                  {noteGroups.folders.map(([folder, paths]) => (
                    <section key={folder} className="mobile-list-section" aria-label={folder}>
                      <h2>{folder}</h2>
                      <NoteRows paths={paths} onOpen={(path) => void openNote(path)} />
                    </section>
                  ))}
                </div>
              ) : (
                <div className="mobile-empty">
                  <strong>No notes yet</strong>
                  <p>Tap “New note” to write your first one.</p>
                </div>
              )}
            </div>
          )
        ) : null}

        {tab === 'review' ? (
          reviewRun ? (
            <div className="mobile-subview mobile-review-run">
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
                onDeleteCard={deleteCard}
                quizQuestionFor={quizQuestionFor}
              />
            </div>
          ) : (
            <div className="mobile-scroll">
              <div className="mobile-list-head">
                <h1>Review</h1>
                {reviewDueCount > 0 ? (
                  <Button size="2" highContrast onClick={() => void startReview(ALL_DECK)}>
                    <LayersIcon /> Review {reviewDueCount}
                  </Button>
                ) : null}
              </div>
              <div className="mobile-review-sidebar">
                <ReviewSidebar
                  system={review}
                  onStart={(deck) => void startReview(deck)}
                  onShare={
                    onShare
                      ? (deck) => void onShare({
                          kind: 'deck',
                          deck,
                          cards: review.cards,
                          linkedCards: review.linked.all(),
                        })
                      : undefined
                  }
                />
              </div>
            </div>
          )
        ) : null}

        {tab === 'quizzes' ? (
          openQuizPath ? (
            <div className="mobile-subview">
              <div className="mobile-subheader">
                <IconButton
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  highContrast
                  aria-label="Back to quizzes"
                  onClick={() => void closeQuiz()}
                >
                  <ChevronLeftIcon width={18} height={18} />
                </IconButton>
                <div className="mobile-subheader-title">
                  <strong>{quizDisplayTitle(openQuizPath)}</strong>
                  {parentDir(openQuizPath) ? <small>{parentDir(openQuizPath)}</small> : null}
                </div>
                {onShare ? (
                  <IconButton
                    type="button"
                    size="2"
                    variant="ghost"
                    color="gray"
                    highContrast
                    aria-label="Share quiz"
                    onClick={() => void onShare({ kind: 'quiz', path: openQuizPath })}
                  >
                    <Share1Icon width={16} height={16} />
                  </IconButton>
                ) : null}
              </div>
              <div className="mobile-quiz editor-wrap">
                {quizLoaded ? (
                  <QuizShell
                    documentPath={openQuizPath}
                    markdown={quizMarkdown}
                    client={aiClient}
                    historyStore={quizHistory}
                    activityStore={dailyActivity}
                    offlineMode={!isOnline}
                    onAddQuestionToFlashcards={(questionId) => addQuizQuestionToFlashcards(openQuizPath, questionId)}
                    isQuestionInFlashcards={(questionId) => isQuizQuestionInFlashcards(openQuizPath, questionId)}
                    onChange={(value) => {
                      setQuizMarkdown(value);
                      setContents((prev) => ({ ...prev, [openQuizPath]: value }));
                    }}
                    onBlur={() => {
                      if (!root) return;
                      void VaultService.write(root, openQuizPath, quizMarkdownRef.current).catch(() => {});
                    }}
                  />
                ) : (
                  <div className="vault-home-pending" aria-busy="true" />
                )}
              </div>
            </div>
          ) : (
            <div className="mobile-scroll">
              <div className="mobile-list-head">
                <h1>Quizzes</h1>
              </div>
              {quizFiles.length ? (
                <div className="mobile-list">
                  <QuizRows
                    paths={quizFiles}
                    attempts={quizHistory.getAll()}
                    onOpen={(path) => void openQuiz(path)}
                  />
                </div>
              ) : (
                <div className="mobile-empty">
                  <strong>No quizzes yet</strong>
                  <p>Quizzes you or your other devices generate appear here, ready to take.</p>
                </div>
              )}
            </div>
          )
        ) : null}
      </main>

      <nav className="mobile-tabbar" aria-label="Sections">
        <TabButton active={tab === 'home'} label="Home" onClick={() => setTab('home')}>
          <HomeIcon width={20} height={20} />
        </TabButton>
        <TabButton active={tab === 'notes'} label="Notes" onClick={() => setTab('notes')}>
          <FileTextIcon width={20} height={20} />
        </TabButton>
        <TabButton
          active={tab === 'review'}
          label="Review"
          badge={reviewDueCount > 0 ? (reviewDueCount > 99 ? '99+' : String(reviewDueCount)) : null}
          onClick={() => setTab('review')}
        >
          <LayersIcon width={20} height={20} />
        </TabButton>
        <TabButton active={tab === 'quizzes'} label="Quizzes" onClick={() => setTab('quizzes')}>
          <ClipboardIcon width={20} height={20} />
        </TabButton>
      </nav>

      {searchOpen ? (
        <SearchPalette
          index={searchIndex}
          recentPaths={recentPaths}
          readNote={readNoteForSearch}
          onOpen={(path) => {
            setSearchOpen(false);
            void openPath(path);
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <Suspense fallback={<div className="mv-settings-panel mv-settings-page" />}>
          <SettingsPanel
            store={settingsStore}
            vaultRoot={root}
            rubricCalibrationSampleCount={0}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      ) : null}

      <div className="mv-toast-stack">
        {gradingJobs
          .filter((job) => job.path !== openQuizPath && !job.toastDismissed && (job.status === 'grading' || job.unseen))
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
                <Button size="1" highContrast onClick={() => void openQuiz(job.path)}>
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
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  badge?: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mobile-tab${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="mobile-tab-icon">
        {children}
        {badge ? <span className="mobile-tab-badge">{badge}</span> : null}
      </span>
      <span className="mobile-tab-label">{label}</span>
    </button>
  );
}

function NoteRows({ paths, onOpen }: { paths: string[]; onOpen: (path: string) => void }) {
  return (
    <ul>
      {paths.map((path) => (
        <li key={path}>
          <button type="button" className="mobile-list-row" onClick={() => onOpen(path)} title={path}>
            <FileTextIcon width={16} height={16} aria-hidden="true" />
            <span className="mobile-list-row-text">
              <strong>{noteTitle(path)}</strong>
              {parentDir(path) ? <small>{parentDir(path)}</small> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function QuizRows({
  paths,
  attempts,
  onOpen,
}: {
  paths: string[];
  attempts: { quizPath: string; percent: number; completedAt: number }[];
  onOpen: (path: string) => void;
}) {
  const stats = useMemo(() => {
    const map = new Map<string, { count: number; lastPercent: number; lastAt: number }>();
    for (const attempt of attempts) {
      const entry = map.get(attempt.quizPath) ?? { count: 0, lastPercent: 0, lastAt: 0 };
      entry.count += 1;
      if (attempt.completedAt >= entry.lastAt) {
        entry.lastAt = attempt.completedAt;
        entry.lastPercent = attempt.percent;
      }
      map.set(attempt.quizPath, entry);
    }
    return map;
  }, [attempts]);

  return (
    <ul>
      {paths.map((path) => {
        const stat = stats.get(path);
        return (
          <li key={path}>
            <button type="button" className="mobile-list-row" onClick={() => onOpen(path)} title={path}>
              <ClipboardIcon width={16} height={16} aria-hidden="true" />
              <span className="mobile-list-row-text">
                <strong>{quizDisplayTitle(path)}</strong>
                {stat ? (
                  <small>
                    {stat.count} attempt{stat.count === 1 ? '' : 's'} · last {stat.lastPercent}%
                  </small>
                ) : (
                  <small>{parentDir(path) || 'Not taken yet'}</small>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
