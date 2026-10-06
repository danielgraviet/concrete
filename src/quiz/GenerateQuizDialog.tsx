import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ClipboardIcon } from '@radix-ui/react-icons';
import { isQuizPath, quizFileTitle } from './paths';
import { parsePageRange } from './pdfContext';
import { isPdfFileName, noteTitle } from '../vault/fileTree';
import type { QuizDifficulty, QuizGenerationSettings } from '../settings';
import type { AutoQuizCounts } from './autoComposition';

export type GenerateQuizDialogResult = {
  title: string;
  sourcePaths: string[];
  /** Page range text per selected PDF ("3-10, 15"); missing or blank = all pages. */
  pageRanges: Record<string, string>;
  /** Per-run generation settings (seeded from Settings, not saved back). */
  settings: QuizGenerationSettings;
  mode: 'manual' | 'auto';
};

type Props = {
  files: string[];
  /** PDFs in the vault; selectable as sources alongside notes. */
  pdfFiles: string[];
  /** Currently open note — preselected when it is not a quiz. */
  defaultSourcePath: string;
  folderHint?: string;
  /** Starting counts / difficulty / rubric, from Settings. */
  defaultSettings: QuizGenerationSettings;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: GenerateQuizDialogResult) => void;
  onAnalyzeAuto: (sources: string[], pageRanges: Record<string, string>) => Promise<AutoQuizCounts>;
};

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
 * Pick source note(s) and a quiz title before calling the AI generator.
 * Defaults to the open note and starts auto composition immediately.
 */
export function GenerateQuizDialog({
  files,
  pdfFiles,
  defaultSourcePath,
  folderHint,
  defaultSettings,
  busy = false,
  onCancel,
  onConfirm,
  onAnalyzeAuto,
}: Props) {
  const noteFiles = useMemo(
    () => {
      const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
      const currentDir = defaultSourcePath ? dirOf(defaultSourcePath) : null;
      // Clicked note first, then notes in its folder, then everything else; A–Z within each group.
      const rank = (path: string) =>
        path === defaultSourcePath ? 0 : currentDir !== null && dirOf(path) === currentDir ? 1 : 2;
      return [...files.filter((path) => !isQuizPath(path)), ...pdfFiles]
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    },
    [files, pdfFiles, defaultSourcePath],
  );

  const initialSources = useMemo(() => {
    if (defaultSourcePath && !isQuizPath(defaultSourcePath)) {
      return [defaultSourcePath];
    }
    return noteFiles[0] ? [noteFiles[0]] : [];
  }, [defaultSourcePath, noteFiles]);

  const [selected, setSelected] = useState<string[]>(initialSources);
  const [title, setTitle] = useState(() =>
    quizFileTitle(defaultTitleFromSources(initialSources)).replace(/^Quiz\s+/, ''),
  );

  const [counts, setCounts] = useState(() => {
    const result = { mcqCount: 0, clozeCount: 0, openCount: 0, codeCount: 0 };
    let remaining = 50;
    for (const key of ['mcqCount', 'clozeCount', 'openCount', 'codeCount'] as const) {
      result[key] = Math.min(remaining, defaultSettings[key]);
      remaining -= result[key];
    }
    return result;
  });
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(defaultSettings.difficulty);
  const [mode, setMode] = useState<'manual' | 'auto'>('auto');
  const [analyzing, setAnalyzing] = useState(() => initialSources.length > 0);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);
  const [countsTouched, setCountsTouched] = useState(false);
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [pageRanges, setPageRanges] = useState<Record<string, string>>({});
  const totalQuestions = counts.mcqCount + counts.clozeCount + counts.openCount + counts.codeCount;
  const rangeInvalid = selected.some((path) => isPdfFileName(path) && pageRangeError(pageRanges[path] ?? ''));
  const analyzeRef = useRef(onAnalyzeAuto);
  analyzeRef.current = onAnalyzeAuto;
  const selectionKey = selected.join('\n');
  const rangeKey = selected
    .filter(isPdfFileName)
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
    !analyzing &&
    !analysisPending &&
    !rangesSettling &&
    selected.length > 0 &&
    totalQuestions > 0 &&
    !rangeInvalid &&
    (mode !== 'auto' || autoAnalyzed || countsTouched);

  useEffect(() => {
    if (!rangesSettling) return undefined;
    const timer = window.setTimeout(() => setSettledRangeKey(rangeKey), 400);
    return () => window.clearTimeout(timer);
  }, [rangeKey, rangesSettling]);

  useEffect(() => {
    if (mode !== 'auto') {
      setAnalyzing(false);
      setAnalysisPending(false);
      return;
    }
    if (selected.length === 0 || rangeInvalid || rangesSettling) {
      setAnalyzing(false);
      setAnalysisPending(rangesSettling && selected.length > 0 && !rangeInvalid);
      if (selected.length === 0 || rangeInvalid) setAutoAnalyzed(false);
      return;
    }

    let cancelled = false;
    setAnalysisError('');
    setAutoAnalyzed(false);
    setCountsTouched(false);
    setAnalysisPending(false);
    setAnalyzing(true);
    const ranges = Object.fromEntries(
      selected.filter(isPdfFileName).map((path) => [path, pageRanges[path] ?? '']),
    );
    const timer = window.setTimeout(() => {
      void analyzeRef
        .current(selected, ranges)
        .then((detected) => {
          if (cancelled) return;
          setCounts(detected);
          setAutoAnalyzed(true);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setAnalysisError(error instanceof Error ? error.message : String(error));
          setAutoAnalyzed(false);
        })
        .finally(() => {
          if (!cancelled) setAnalyzing(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, selectionKey, settledRangeKey, rangeInvalid, rangesSettling, analysisAttempt, selected, pageRanges]);

  const setCount = (key: keyof typeof counts, raw: number) => {
    const otherCount = Object.entries(counts).reduce(
      (sum, [otherKey, count]) => otherKey === key ? sum : sum + count,
      0,
    );
    const n = Number.isFinite(raw) ? Math.max(0, Math.min(50 - otherCount, Math.round(raw))) : 0;
    setCountsTouched(true);
    setCounts((current) => ({ ...current, [key]: n }));
  };

  const toggle = (path: string) => {
    setSelected((current) => {
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path];
      if (next.length > 0) {
        setTitle((prev) => {
          const prevDefault = defaultTitleFromSources(current).replace(/^Quiz\s+/i, '');
          if (!prev.trim() || prev.trim() === prevDefault) {
            return defaultTitleFromSources(next).replace(/^Quiz\s+/i, '');
          }
          return prev;
        });
      }
      return next;
    });
  };

  const submit = () => {
    if (!canSubmit) return;
    const descriptive = title.trim() || defaultTitleFromSources(selected);
    onConfirm({
      title: quizFileTitle(descriptive),
      sourcePaths: selected,
      pageRanges: Object.fromEntries(
        selected.filter(isPdfFileName).map((path) => [path, pageRanges[path] ?? '']),
      ),
      settings: { ...defaultSettings, ...counts, difficulty },
      mode,
    });
  };

  return (
    <div className="mv-overlay mv-prompt-overlay" role="dialog" aria-modal="true">
      <Card size="3" className="generate-quiz-panel">
        <Flex direction="column" gap="3" className="generate-quiz-layout">
          <Flex gap="3" align="start" className="generate-quiz-heading">
            <ClipboardIcon width={20} height={20} />
            <Box>
              <Heading size="4">Generate quiz</Heading>
              <Text size="2" color="gray">
                Ground questions in selected notes or PDFs
                {folderHint ? ` · saves under ${folderHint}` : ''}.
              </Text>
            </Box>
          </Flex>

          <Flex direction="column" gap="2" className="generate-quiz-title-field">
            <Text size="2" weight="medium">
              Quiz title
            </Text>
            <TextField.Root
              value={title}
              disabled={busy}
              placeholder="t-tests"
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </Flex>

          <Flex direction="column" gap="2" className="generate-quiz-source-section">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Sources
              </Text>
              <Text size="1" color="gray">
                {selected.length} selected
              </Text>
            </Flex>
            {noteFiles.length === 0 ? (
              <Text size="2" color="gray">
                No notes available. Create a note or add a PDF to your vault first.
              </Text>
            ) : (
              <ScrollArea
                type="auto"
                scrollbars="vertical"
                className="generate-quiz-source-scroll"
                style={{ maxHeight: 170 }}
              >
                <Flex direction="column" gap="2" pr="2">
                  {noteFiles.map((path) => {
                    const checked = selected.includes(path);
                    const isDefault = path === defaultSourcePath;
                    const isPdf = isPdfFileName(path);
                    const rangeError = isPdf && checked ? pageRangeError(pageRanges[path] ?? '') : null;
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
                          <Checkbox
                            checked={checked}
                            disabled={busy || analyzing}
                            onCheckedChange={() => toggle(path)}
                          />
                          <Flex direction="column" gap="1" flexGrow="1">
                            <Text size="2">{noteTitle(path)}</Text>
                            <Text size="1" color="gray">
                              {isPdf ? 'PDF · ' : ''}
                              {path}
                              {isDefault ? ' · current' : ''}
                            </Text>
                            {isPdf && checked && (
                              <>
                                <TextField.Root
                                  size="1"
                                  value={pageRanges[path] ?? ''}
                                  disabled={busy || analyzing}
                                  placeholder="Pages, e.g. 1-20, 25 (blank = all)"
                                  aria-label={`Pages to use from ${noteTitle(path)}`}
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
                            )}
                          </Flex>
                        </label>
                      </Flex>
                    );
                  })}
                </Flex>
              </ScrollArea>
            )}
          </Flex>

          <Flex direction="column" gap="2" className="generate-quiz-settings">
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Question counts</Text>
              <SegmentedControl.Root
                value={mode}
                disabled={busy || analyzing}
                onValueChange={(value) => {
                  setMode(value as 'manual' | 'auto');
                  setAnalysisError('');
                  if (value === 'manual') setAutoAnalyzed(false);
                }}
              >
                <SegmentedControl.Item value="manual">Manual</SegmentedControl.Item>
                <SegmentedControl.Item value="auto">Auto from source</SegmentedControl.Item>
              </SegmentedControl.Root>
              {mode === 'auto' && (
                <Flex direction="column" gap="2">
                  <Text size="1" color={analysisError ? 'red' : autoAnalyzed && !analyzing && !analysisPending && !rangesSettling ? 'green' : 'gray'}>
                    {analysisError
                      ? analysisError
                      : analyzing || analysisPending || rangesSettling
                        ? 'Choosing question counts from the selected sources…'
                        : autoAnalyzed
                          ? 'Counts are ready. Change any of them below, then generate.'
                          : 'Select a source to choose question counts.'}
                  </Text>
                  {analysisError && (
                    <Button
                      variant="soft"
                      disabled={selected.length === 0 || rangeInvalid || busy || analyzing}
                      onClick={() => setAnalysisAttempt((attempt) => attempt + 1)}
                    >
                      Try again
                    </Button>
                  )}
                </Flex>
              )}
            </Flex>
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Questions
              </Text>
              <Text size="1" color="gray">
                {totalQuestions} total
              </Text>
            </Flex>
            <Flex gap="3" wrap="wrap">
              {(
                [
                  ['mcqCount', 'Multiple choice'],
                  ['clozeCount', 'Cloze'],
                  ['openCount', 'Open'],
                  ['codeCount', 'Code'],
                ] as const
              ).map(([key, label]) => (
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
              disabled={busy || analyzing}
              onValueChange={(value) => setDifficulty(value as QuizDifficulty)}
            >
              <SegmentedControl.Item value="easy">Easy</SegmentedControl.Item>
              <SegmentedControl.Item value="medium">Medium</SegmentedControl.Item>
              <SegmentedControl.Item value="hard">Hard</SegmentedControl.Item>
            </SegmentedControl.Root>
            <Text size="1" color="gray">
              {mode === 'auto'
                ? 'Counts come from the selected sources. Changes here apply to this quiz only.'
                : 'Starts from your Settings defaults. Changes here apply to this quiz only.'}
            </Text>
          </Flex>

          <Flex gap="3" justify="end" className="generate-quiz-actions">
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
