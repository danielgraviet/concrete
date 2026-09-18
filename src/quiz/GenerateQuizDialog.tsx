import { useMemo, useState } from 'react';
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
import { noteTitle } from '../vault/fileTree';
import type { QuizDifficulty, QuizGenerationSettings } from '../settings';

export type GenerateQuizDialogResult = {
  title: string;
  sourcePaths: string[];
  /** Per-run generation settings (seeded from Settings, not saved back). */
  settings: QuizGenerationSettings;
};

type Props = {
  files: string[];
  /** Currently open note — preselected when it is not a quiz. */
  defaultSourcePath: string;
  folderHint?: string;
  /** Starting counts / difficulty / rubric, from Settings. */
  defaultSettings: QuizGenerationSettings;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: GenerateQuizDialogResult) => void;
};

function defaultTitleFromSources(paths: string[]): string {
  if (paths.length === 0) return 'Untitled';
  if (paths.length === 1) return noteTitle(paths[0]);
  return `${noteTitle(paths[0])} +${paths.length - 1}`;
}

/**
 * Pick source note(s) and a quiz title before calling the AI generator.
 * Defaults to the open note; allows multi-select.
 */
export function GenerateQuizDialog({
  files,
  defaultSourcePath,
  folderHint,
  defaultSettings,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const noteFiles = useMemo(
    () => {
      const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
      const currentDir = defaultSourcePath ? dirOf(defaultSourcePath) : null;
      // Clicked note first, then notes in its folder, then everything else; A–Z within each group.
      const rank = (path: string) =>
        path === defaultSourcePath ? 0 : currentDir !== null && dirOf(path) === currentDir ? 1 : 2;
      return files
        .filter((path) => !isQuizPath(path))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    },
    [files, defaultSourcePath],
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

  const [counts, setCounts] = useState({
    mcqCount: defaultSettings.mcqCount,
    clozeCount: defaultSettings.clozeCount,
    openCount: defaultSettings.openCount,
    codeCount: defaultSettings.codeCount,
  });
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(defaultSettings.difficulty);
  const totalQuestions = counts.mcqCount + counts.clozeCount + counts.openCount + counts.codeCount;

  const setCount = (key: keyof typeof counts, raw: number) => {
    const n = Number.isFinite(raw) ? Math.max(0, Math.min(20, Math.round(raw))) : 0;
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
    if (busy || selected.length === 0 || totalQuestions === 0) return;
    const descriptive = title.trim() || defaultTitleFromSources(selected);
    onConfirm({
      title: quizFileTitle(descriptive),
      sourcePaths: selected,
      settings: { ...defaultSettings, ...counts, difficulty },
    });
  };

  return (
    <div className="mv-overlay mv-prompt-overlay" role="dialog" aria-modal="true">
      <Card size="3" className="generate-quiz-panel">
        <Flex direction="column" gap="4">
          <Flex gap="3" align="start">
            <ClipboardIcon width={20} height={20} />
            <Box>
              <Heading size="4">Generate quiz</Heading>
              <Text size="2" color="gray">
                Ground questions in selected notes
                {folderHint ? ` · saves under ${folderHint}` : ''}.
              </Text>
            </Box>
          </Flex>

          <Flex direction="column" gap="2">
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

          <Flex direction="column" gap="2">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Source notes
              </Text>
              <Text size="1" color="gray">
                {selected.length} selected
              </Text>
            </Flex>
            {noteFiles.length === 0 ? (
              <Text size="2" color="gray">
                No notes available. Create a note first.
              </Text>
            ) : (
              <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 280 }}>
                <Flex direction="column" gap="2" pr="2">
                  {noteFiles.map((path) => {
                    const checked = selected.includes(path);
                    const isDefault = path === defaultSourcePath;
                    return (
                      <Flex
                        key={path}
                        asChild
                        align="start"
                        gap="3"
                        p="2"
                        className={`generate-quiz-file ${checked ? 'selected' : ''}`}
                      >
                        <label>
                          <Checkbox
                            checked={checked}
                            disabled={busy}
                            onCheckedChange={() => toggle(path)}
                          />
                          <Flex direction="column" gap="1">
                            <Text size="2">{noteTitle(path)}</Text>
                            <Text size="1" color="gray">
                              {path}
                              {isDefault ? ' · current' : ''}
                            </Text>
                          </Flex>
                        </label>
                      </Flex>
                    );
                  })}
                </Flex>
              </ScrollArea>
            )}
          </Flex>

          <Flex direction="column" gap="2">
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
                    max={20}
                    value={String(counts[key])}
                    disabled={busy}
                    onChange={(e) => setCount(key, Number(e.target.value))}
                  />
                </label>
              ))}
            </Flex>
            <SegmentedControl.Root
              value={difficulty}
              onValueChange={(value) => setDifficulty(value as QuizDifficulty)}
            >
              <SegmentedControl.Item value="easy">Easy</SegmentedControl.Item>
              <SegmentedControl.Item value="medium">Medium</SegmentedControl.Item>
              <SegmentedControl.Item value="hard">Hard</SegmentedControl.Item>
            </SegmentedControl.Root>
            <Text size="1" color="gray">
              Starts from your Settings defaults; changes here apply to this quiz only.
            </Text>
          </Flex>

          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              highContrast
              disabled={busy || selected.length === 0 || totalQuestions === 0}
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
