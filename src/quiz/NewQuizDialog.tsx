import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  ScrollArea,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import { isQuizPath, quizFileTitle } from './paths';
import { parsePageRange } from './pdfContext';
import { notePathKey } from './QuizFromNotePrompt';
import { isDocumentFileName, isSlideDeckFileName, noteTitle } from '../vault/fileTree';
import type { QuizDifficulty, QuizGenerationSettings } from '../settings';
import type { AutoQuizAnalysis, AutoQuizCounts, ExistingSourceQuiz } from './autoComposition';
import {
  canAddAsQuizSource,
  QUIZ_SIZE_PRESETS,
  QUIZ_SOURCE_ACCEPT,
  scaleQuizCounts,
  sourceStatusLabel,
  type QuizSizePreset,
} from './newQuiz';
import type { ImportedSource } from './quizSources';

export type NewQuizDialogResult = {
  title: string;
  sourcePaths: string[];
  /** Page or slide range text per selected PDF or deck ("3-10, 15"); missing or blank = all. */
  pageRanges: Record<string, string>;
  /** Per-run generation settings (seeded from Settings, not saved back). */
  settings: QuizGenerationSettings;
  sourceIntent: 'generate' | 'recreate' | 'similar';
  sourceQuizContext?: string;
};

type Props = {
  files: string[];
  /** PDFs and slide decks in the vault; selectable as sources alongside notes. */
  pdfFiles: string[];
  existingSourceQuizzes: ReadonlyMap<string, ExistingSourceQuiz>;
  quizSourceIndexReady: boolean;
  /** Currently open note — preselected when it is not a quiz. */
  defaultSourcePath: string;
  folderHint?: string;
  /** Starting counts / difficulty / rubric, from Settings. */
  defaultSettings: QuizGenerationSettings;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: NewQuizDialogResult) => void;
  onAnalyzeAuto: (sources: string[], pageRanges: Record<string, string>) => Promise<AutoQuizAnalysis>;
  /** Save a dropped or chosen deck/PDF into the vault (under Sources/). */
  onAddFile: (file: PickedFile) => Promise<ImportedSource>;
};

/** A file dropped or chosen in this dialog, and how its import went. */
type AddedFile = {
  id: number;
  name: string;
  status: 'adding' | 'ready' | 'error';
  path?: string;
  label?: string;
  error?: string;
};

type SizeChoice = QuizSizePreset['id'] | 'custom';

const COUNT_FIELDS = [
  ['mcqCount', 'Multiple choice'],
  ['clozeCount', 'Cloze'],
  ['openCount', 'Open'],
  ['codeCount', 'Code'],
] as const;

function capCounts(counts: AutoQuizCounts): AutoQuizCounts {
  const result = { mcqCount: 0, clozeCount: 0, openCount: 0, codeCount: 0 };
  let remaining = 50;
  for (const [key] of COUNT_FIELDS) {
    result[key] = Math.max(0, Math.min(remaining, counts[key]));
    remaining -= result[key];
  }
  return result;
}

function describeMix(counts: AutoQuizCounts): string {
  return COUNT_FIELDS.filter(([key]) => counts[key] > 0)
    .map(([key, label]) => `${counts[key]} ${label.toLowerCase()}`)
    .join(', ');
}

function defaultTitleFromSources(paths: string[]): string {
  if (paths.length === 0) return 'Untitled';
  if (paths.length === 1) return noteTitle(paths[0]);
  return `${noteTitle(paths[0])} +${paths.length - 1}`;
}

function pageRangeError(input: string): string | null {
  try {
    parsePageRange(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * New quiz: drop in slides or PDFs (saved to Sources/) or pick vault files,
 * choose a size, and generate. Defaults to the open note when there is one
 * and estimates the question mix as soon as sources are picked.
 */
export function NewQuizDialog({
  files,
  pdfFiles,
  existingSourceQuizzes,
  quizSourceIndexReady,
  defaultSourcePath,
  folderHint,
  defaultSettings,
  busy = false,
  onCancel,
  onConfirm,
  onAnalyzeAuto,
  onAddFile,
}: Props) {
  const [added, setAdded] = useState<AddedFile[]>([]);
  const addedPaths = useMemo(
    () => new Set(added.flatMap((file) => (file.path ? [file.path] : []))),
    [added],
  );

  const vaultFiles = useMemo(
    () => {
      const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
      const currentDir = defaultSourcePath ? dirOf(defaultSourcePath) : null;
      // Clicked note first, then notes in its folder, then everything else; A–Z within each group.
      const rank = (path: string) =>
        path === defaultSourcePath ? 0 : currentDir !== null && dirOf(path) === currentDir ? 1 : 2;
      return [...files, ...pdfFiles]
        .filter((path) => !addedPaths.has(path))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    },
    [files, pdfFiles, defaultSourcePath, addedPaths],
  );

  // Opened from a note: start with it. Opened from home: start empty, ready for a drop.
  const initialSources = useMemo(() => (defaultSourcePath ? [defaultSourcePath] : []), [defaultSourcePath]);

  const [selected, setSelected] = useState<string[]>(initialSources);
  const [title, setTitle] = useState(() =>
    initialSources.length > 0 ? quizFileTitle(defaultTitleFromSources(initialSources)).replace(/^Quiz\s+/, '') : '',
  );
  const [vaultOpen, setVaultOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const [mix, setMix] = useState<AutoQuizCounts>(() => capCounts(defaultSettings));
  const [size, setSize] = useState<SizeChoice>('standard');
  const [customCounts, setCustomCounts] = useState<AutoQuizCounts>(() => capCounts(defaultSettings));
  const counts: AutoQuizCounts =
    size === 'custom'
      ? customCounts
      : scaleQuizCounts(mix, QUIZ_SIZE_PRESETS.find((preset) => preset.id === size)?.total ?? 20);

  const [difficulty, setDifficulty] = useState<QuizDifficulty>(defaultSettings.difficulty);
  const [sourceIntent, setSourceIntent] = useState<'generate' | 'recreate' | 'similar'>(() =>
    defaultSourcePath && isQuizPath(defaultSourcePath) ? 'similar' : 'generate',
  );
  const [analyzing, setAnalyzing] = useState(() => initialSources.length > 0);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [pageRanges, setPageRanges] = useState<Record<string, string>>({});
  const totalQuestions = counts.mcqCount + counts.clozeCount + counts.openCount + counts.codeCount;
  const relatedQuizzes = [...new Map(
    selected
      .map((path) => existingSourceQuizzes.get(notePathKey(path)))
      .filter((quiz): quiz is ExistingSourceQuiz => Boolean(quiz))
      .map((quiz) => [notePathKey(quiz.quizPath), quiz] as const),
  ).values()];
  const rangeInvalid = selected.some((path) => isDocumentFileName(path) && pageRangeError(pageRanges[path] ?? ''));
  const adding = added.some((file) => file.status === 'adding');
  const analyzeRef = useRef(onAnalyzeAuto);
  analyzeRef.current = onAnalyzeAuto;
  const selectionKey = selected.join('\n');
  const rangeKey = selected
    .filter(isDocumentFileName)
    .map((path) => `${path}\t${pageRanges[path] ?? ''}`)
    .join('\n');
  const [trackedSelection, setTrackedSelection] = useState(selectionKey);
  const [settledRangeKey, setSettledRangeKey] = useState(rangeKey);
  if (trackedSelection !== selectionKey) {
    setTrackedSelection(selectionKey);
    setSettledRangeKey(rangeKey);
  }
  const rangesSettling = settledRangeKey !== rangeKey;
  const canSubmit =
    !busy &&
    !adding &&
    !analyzing &&
    !analysisPending &&
    !rangesSettling &&
    selected.length > 0 &&
    totalQuestions > 0 &&
    !rangeInvalid;

  useEffect(() => {
    if (!rangesSettling) return undefined;
    const timer = window.setTimeout(() => setSettledRangeKey(rangeKey), 400);
    return () => window.clearTimeout(timer);
  }, [rangeKey, rangesSettling]);

  useEffect(() => {
    if (selected.length > 0 && !quizSourceIndexReady) {
      setAnalyzing(true);
      setAnalysisPending(false);
      return;
    }
    if (selected.length === 0 || rangeInvalid || rangesSettling) {
      setAnalyzing(false);
      setAnalysisPending(rangesSettling && selected.length > 0 && !rangeInvalid);
      return;
    }

    if (relatedQuizzes.length > 0) {
      // Practising an existing quiz: match its size exactly.
      const combined: AutoQuizCounts = { mcqCount: 0, clozeCount: 0, openCount: 0, codeCount: 0 };
      for (const quiz of relatedQuizzes) {
        for (const key of Object.keys(combined) as (keyof AutoQuizCounts)[]) {
          combined[key] += quiz.counts[key];
        }
      }
      setCustomCounts(capCounts(combined));
      setSize('custom');
      setSourceIntent('similar');
      setAnalyzing(false);
      setAnalysisPending(false);
      return;
    }

    let cancelled = false;
    setAnalysisPending(false);
    setAnalyzing(true);
    const ranges = Object.fromEntries(
      selected.filter(isDocumentFileName).map((path) => [path, pageRanges[path] ?? '']),
    );
    const timer = window.setTimeout(() => {
      void analyzeRef
        .current(selected, ranges)
        .then((detected) => {
          if (cancelled) return;
          const { sourceIntent: detectedIntent, ...detectedCounts } = detected;
          setSourceIntent(detectedIntent);
          if (detectedIntent === 'recreate') {
            // Recreating a worksheet keeps its own question count.
            setCustomCounts(capCounts(detectedCounts));
            setSize('custom');
          } else {
            setMix(detectedCounts);
            setCustomCounts(capCounts(detectedCounts));
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.error('Quiz composition estimate failed', error);
        })
        .finally(() => {
          if (!cancelled) setAnalyzing(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectionKey, settledRangeKey, rangeInvalid, rangesSettling, selected, pageRanges, quizSourceIndexReady, existingSourceQuizzes]);

  const setCount = (key: keyof AutoQuizCounts, raw: number) => {
    const otherCount = Object.entries(counts).reduce(
      (sum, [otherKey, count]) => otherKey === key ? sum : sum + count,
      0,
    );
    const n = Number.isFinite(raw) ? Math.max(0, Math.min(50 - otherCount, Math.round(raw))) : 0;
    setCustomCounts({ ...counts, [key]: n });
    setSize('custom');
  };

  /** Change the selection and keep an untouched title in step with it. */
  const updateSelection = (change: (current: string[]) => string[]) => {
    setSelected((current) => {
      const next = change(current);
      if (next.length > 0) {
        setTitle((prev) => {
          const prevDefault = current.length > 0 ? defaultTitleFromSources(current).replace(/^Quiz\s+/i, '') : '';
          if (!prev.trim() || prev.trim() === prevDefault) {
            return defaultTitleFromSources(next).replace(/^Quiz\s+/i, '');
          }
          return prev;
        });
      }
      return next;
    });
  };

  const toggle = (path: string) => {
    updateSelection((current) =>
      current.includes(path) ? current.filter((p) => p !== path) : [...current, path],
    );
  };

  const addFiles = (picked: Iterable<File>) => {
    for (const file of picked) {
      const id = nextId.current++;
      if (!canAddAsQuizSource(file.name)) {
        setAdded((current) => [
          ...current,
          { id, name: file.name, status: 'error', error: 'Only .pptx slide decks and PDFs for now.' },
        ]);
        continue;
      }
      setAdded((current) => [...current, { id, name: file.name, status: 'adding' }]);
      void file
        .arrayBuffer()
        .then((buffer) => onAddFile({ name: file.name, bytes: new Uint8Array(buffer) }))
        .then((imported) => {
          setAdded((current) =>
            current.map((entry) =>
              entry.id === id
                ? { ...entry, status: 'ready', path: imported.path, label: sourceStatusLabel(imported) }
                : entry,
            ),
          );
          updateSelection((current) => (current.includes(imported.path) ? current : [...current, imported.path]));
        })
        .catch((error: unknown) => {
          setAdded((current) =>
            current.map((entry) =>
              entry.id === id
                ? { ...entry, status: 'error', error: error instanceof Error ? error.message : String(error) }
                : entry,
            ),
          );
        });
    }
  };

  const removeAdded = (entry: AddedFile) => {
    setAdded((current) => current.filter((other) => other.id !== entry.id));
    if (entry.path) {
      const path = entry.path;
      setSelected((current) => current.filter((p) => p !== path));
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    const descriptive = title.trim() || defaultTitleFromSources(selected);
    onConfirm({
      title: quizFileTitle(descriptive),
      sourcePaths: selected,
      pageRanges: Object.fromEntries(
        selected.filter(isDocumentFileName).map((path) => [path, pageRanges[path] ?? '']),
      ),
      settings: { ...defaultSettings, ...counts, difficulty },
      sourceIntent,
      sourceQuizContext: relatedQuizzes
        .filter((quiz) => !selected.some((path) => notePathKey(path) === notePathKey(quiz.quizPath)))
        .map((quiz) => `### Existing quiz: ${quiz.quizPath}\n\n${quiz.markdown}`)
        .join('\n\n-----\n\n'),
    });
  };

  const rangeField = (path: string): ReactNode => {
    if (!isDocumentFileName(path) || !selected.includes(path)) return null;
    const isDeck = isSlideDeckFileName(path);
    const rangeError = pageRangeError(pageRanges[path] ?? '');
    return (
      <>
        <TextField.Root
          size="1"
          value={pageRanges[path] ?? ''}
          disabled={busy}
          placeholder={`${isDeck ? 'Slides' : 'Pages'}, e.g. 1-20, 25 (blank = all)`}
          aria-label={`${isDeck ? 'Slides' : 'Pages'} to use from ${noteTitle(path)}`}
          onChange={(e) => {
            setPageRanges((current) => ({ ...current, [path]: e.target.value }));
          }}
        />
        {rangeError && (
          <Text size="1" color="red">
            {rangeError}
          </Text>
        )}
      </>
    );
  };

  const selectedFromVault = selected.filter((path) => !addedPaths.has(path));
  const mixSummary = describeMix(counts);

  return (
    <div
      className="mv-overlay mv-prompt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-quiz-heading"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel();
      }}
    >
      <Card
        size="3"
        className="generate-quiz-panel new-quiz-panel"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <Flex direction="column" gap="3" className="generate-quiz-layout">
          <Flex gap="3" align="start" className="generate-quiz-heading">
            <ClipboardIcon width={20} height={20} />
            <Box>
              <Heading size="4" id="new-quiz-heading">New quiz</Heading>
              <Text size="2" color="gray">
                Add your slides or PDFs, or pick from your vault
                {folderHint ? ` · saves under ${folderHint}` : ''}.
              </Text>
            </Box>
          </Flex>

          <button
            type="button"
            className={`new-quiz-dropzone${dragging ? ' dragging' : ''}`}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon width={20} height={20} />
            <span className="new-quiz-dropzone-title">Drop slides or PDFs here</span>
            <span className="new-quiz-dropzone-hint">
              or <u>choose files</u> · .pptx and .pdf · saved to Sources/
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={QUIZ_SOURCE_ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles([...e.target.files]);
              e.target.value = '';
            }}
          />

          {added.length > 0 && (
            <Flex direction="column" gap="2" className="new-quiz-added">
              {added.map((entry) => (
                <Flex key={entry.id} align="start" gap="2" className={`new-quiz-added-file ${entry.status}`}>
                  <span className="new-quiz-added-icon" aria-hidden>
                    {entry.status === 'ready' ? (
                      <CheckIcon />
                    ) : entry.status === 'error' ? (
                      <ExclamationTriangleIcon />
                    ) : (
                      <span className="new-quiz-spinner" />
                    )}
                  </span>
                  <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
                    <Flex justify="between" gap="2" align="center">
                      <Text size="2" truncate>{entry.name}</Text>
                      <Text size="1" color={entry.status === 'error' ? 'red' : 'gray'} className="new-quiz-added-status">
                        {entry.status === 'adding' ? 'Adding…' : entry.status === 'ready' ? entry.label : 'Not added'}
                      </Text>
                    </Flex>
                    {entry.error && (
                      <Text size="1" color="red">
                        {entry.error}
                      </Text>
                    )}
                    {entry.path ? rangeField(entry.path) : null}
                  </Flex>
                  <button
                    type="button"
                    className="new-quiz-remove"
                    aria-label={`Remove ${entry.name}`}
                    disabled={busy || entry.status === 'adding'}
                    onClick={() => removeAdded(entry)}
                  >
                    <Cross2Icon />
                  </button>
                </Flex>
              ))}
            </Flex>
          )}

          <Flex direction="column" gap="2" className="generate-quiz-source-section">
            <button
              type="button"
              className="new-quiz-disclosure"
              aria-expanded={vaultOpen}
              onClick={() => setVaultOpen((open) => !open)}
            >
              {vaultOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              <span>From your vault</span>
              <span className="new-quiz-disclosure-meta">
                {selectedFromVault.length > 0
                  ? selectedFromVault.length === 1
                    ? noteTitle(selectedFromVault[0])
                    : `${selectedFromVault.length} selected`
                  : `${vaultFiles.length} files`}
              </span>
            </button>
            {vaultOpen &&
              (vaultFiles.length === 0 ? (
                <Text size="2" color="gray">
                  Nothing in your vault yet. Drop a file above instead.
                </Text>
              ) : (
                <ScrollArea
                  type="auto"
                  scrollbars="vertical"
                  className="generate-quiz-source-scroll"
                  style={{ maxHeight: 170 }}
                >
                  <Flex direction="column" gap="2" pr="2">
                    {vaultFiles.map((path) => {
                      const checked = selected.includes(path);
                      const isDefault = path === defaultSourcePath;
                      const isPdf = isDocumentFileName(path);
                      const isDeck = isSlideDeckFileName(path);
                      return (
                        <Flex
                          key={path}
                          asChild
                          align="start"
                          gap="3"
                          p="1"
                          className={`generate-quiz-file ${checked ? 'selected' : ''}`}
                        >
                          <label>
                            <Checkbox checked={checked} disabled={busy} onCheckedChange={() => toggle(path)} />
                            <Flex direction="column" gap="1" flexGrow="1">
                              <Text size="2">{noteTitle(path)}</Text>
                              <Text size="1" color="gray">
                                {isDeck ? 'Slides · ' : isPdf ? 'PDF · ' : isQuizPath(path) ? 'Existing quiz · ' : ''}
                                {path}
                                {isDefault ? ' · current' : ''}
                              </Text>
                              {rangeField(path)}
                            </Flex>
                          </label>
                        </Flex>
                      );
                    })}
                  </Flex>
                </ScrollArea>
              ))}
          </Flex>

          <Flex direction="column" gap="2" className="generate-quiz-title-field">
            <Text size="2" weight="medium">
              Title
            </Text>
            <TextField.Root
              value={title}
              disabled={busy}
              placeholder="Named after your sources"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </Flex>

          <Flex direction="column" gap="2" className="generate-quiz-settings">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Size
              </Text>
              <Text size="1" color="gray">
                {analyzing ? 'Reading your sources…' : `${totalQuestions} questions`}
              </Text>
            </Flex>
            <SegmentedControl.Root
              value={size === 'custom' ? '' : size}
              disabled={busy}
              onValueChange={(value) => setSize(value as SizeChoice)}
            >
              {QUIZ_SIZE_PRESETS.map((preset) => (
                <SegmentedControl.Item key={preset.id} value={preset.id}>
                  {preset.label} {preset.total}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
            <Flex justify="between" align="center" gap="2">
              <Text size="1" color="gray">
                {mixSummary || 'No questions'} · {difficulty[0].toUpperCase() + difficulty.slice(1)}
                {sourceIntent === 'recreate' ? ' · recreating source' : sourceIntent === 'similar' ? ' · similar practice' : ''}
                {size === 'custom' ? ' · custom' : ''}
              </Text>
              <button
                type="button"
                className="new-quiz-disclosure new-quiz-customize"
                aria-expanded={customizeOpen}
                onClick={() => setCustomizeOpen((open) => !open)}
              >
                Customize {customizeOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </button>
            </Flex>

            {customizeOpen && (
              <Flex direction="column" gap="3" className="new-quiz-customize-panel">
                <Flex gap="3" wrap="wrap">
                  {COUNT_FIELDS.map(([key, label]) => (
                    <label key={key} className="mv-quiz-count-field">
                      <Text size="1" color="gray">
                        {label}
                      </Text>
                      <TextField.Root
                        type="number"
                        min={0}
                        max={50}
                        value={String(counts[key])}
                        disabled={busy || analyzing || analysisPending || rangesSettling}
                        onChange={(e) => setCount(key, Number(e.target.value))}
                      />
                    </label>
                  ))}
                </Flex>
                <SegmentedControl.Root
                  value={difficulty}
                  disabled={busy}
                  onValueChange={(value) => setDifficulty(value as QuizDifficulty)}
                >
                  <SegmentedControl.Item value="easy">Easy</SegmentedControl.Item>
                  <SegmentedControl.Item value="medium">Medium</SegmentedControl.Item>
                  <SegmentedControl.Item value="hard">Hard</SegmentedControl.Item>
                </SegmentedControl.Root>
                <Flex direction="column" gap="2">
                  <SegmentedControl.Root
                    value={sourceIntent}
                    disabled={busy || analyzing}
                    onValueChange={(value) => setSourceIntent(value as typeof sourceIntent)}
                  >
                    <SegmentedControl.Item value="generate">New from source</SegmentedControl.Item>
                    <SegmentedControl.Item value="recreate">Recreate this quiz</SegmentedControl.Item>
                    <SegmentedControl.Item value="similar">Similar practice</SegmentedControl.Item>
                  </SegmentedControl.Root>
                  <Text size="1" color="gray">
                    {sourceIntent === 'recreate'
                      ? 'Preserve the source questions and answer key, formatted as a Concrete quiz.'
                      : sourceIntent === 'similar'
                        ? 'Write new questions that practice the same skills and match the source difficulty.'
                        : 'Generate useful questions from the selected material.'}
                  </Text>
                </Flex>
              </Flex>
            )}
          </Flex>

          <Flex gap="3" justify="end" align="center" className="generate-quiz-actions">
            {selected.length === 0 && !adding && (
              <Text size="1" color="gray" mr="auto">
                Add a file or pick one from your vault.
              </Text>
            )}
            <Button variant="soft" color="gray" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              highContrast
              disabled={!canSubmit}
              loading={busy}
              onClick={submit}
            >
              <ClipboardIcon />
              Generate quiz
            </Button>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}
