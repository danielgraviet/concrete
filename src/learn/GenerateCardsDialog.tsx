import { useEffect, useState } from 'react';
import { Box, Button, Card, Flex, Heading, ScrollArea, SegmentedControl, Text } from '@radix-ui/themes';
import { LightningBoltIcon } from '@radix-ui/react-icons';
import type { AiClient } from '../ai/AiClient';
import { truncateNoteContext } from '../ai';
import { QuizMarkdown } from '../quiz/QuizMarkdown';
import { noteTitle } from '../vault/fileTree';
import { parseNoteCards } from './parseNoteCards';

type Style = 'mixed' | 'basic' | 'cloze';

const STYLE_RULES: Record<Style, string> = {
  mixed: 'Mix question/answer cards and cloze cards, whichever suits each fact.',
  basic: 'Only question/answer cards.',
  cloze: 'Only cloze cards.',
};

function buildPrompt(style: Style, existing: string[]): string {
  return [
    'Write spaced-repetition flashcards for the note below.',
    '',
    'Format — one card per line, nothing else (no numbering, no headings, no commentary):',
    '- Question/answer card: `Question :: Answer`',
    '- Cloze card: a sentence with the hidden part in double braces, e.g. `The {{mitochondria}} produces ATP.`',
    '',
    'Rules:',
    '- Each card tests exactly one fact or idea (minimum information principle).',
    '- Questions must make sense on their own, without the note.',
    '- Answers are short: a word, phrase or one sentence.',
    '- Cover the most important ideas first; skip trivia. 5–15 cards.',
    '- Inline code in backticks and math in $…$ are fine. Never put `::` inside code.',
    `- ${STYLE_RULES[style]}`,
    ...(existing.length
      ? ['', 'The note already has these cards — do not repeat them:', ...existing.map((line) => `- ${line}`)]
      : []),
  ].join('\n');
}

/** Keep only output lines that parse as cards. */
export function cardLinesFromModel(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^`(.*)`$/, '$1').trim())
    .filter((line) => line && parseNoteCards(line).length > 0);
}

type Props = {
  client: AiClient;
  path: string;
  content: string;
  existing: string[];
  onInsert: (lines: string[]) => void;
  onCancel: () => void;
};

export function GenerateCardsDialog({ client, path, content, existing, onInsert, onCancel }: Props) {
  const [style, setStyle] = useState<Style>('mixed');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const generate = async () => {
    setStatus('running');
    setError('');
    try {
      const reply = await client.getProvider().complete({
        prompt: buildPrompt(style, existing),
        context: truncateNoteContext(content, 12000),
      });
      const found = cardLinesFromModel(reply);
      setLines(found);
      setPicked(new Set(found.map((_, i) => i)));
      setStatus('done');
      if (found.length === 0) setError('The model did not return any cards. Check your AI provider in Settings and try again.');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Card generation failed.');
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const toggle = (i: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="mv-overlay mv-prompt-overlay" role="dialog" aria-modal="true" aria-label="Generate cards">
      <Card size="3" className="generate-quiz-panel srs-generate">
        <Flex direction="column" gap="4">
          <Flex gap="3" align="start">
            <LightningBoltIcon width={20} height={20} />
            <Box>
              <Heading size="4">Generate cards</Heading>
              <Text size="2" color="gray">
                From “{noteTitle(path)}” · picked cards are added to the end of the note, where you can edit them.
              </Text>
            </Box>
          </Flex>

          <SegmentedControl.Root value={style} onValueChange={(value) => setStyle(value as Style)}>
            <SegmentedControl.Item value="mixed">Mixed</SegmentedControl.Item>
            <SegmentedControl.Item value="basic">Q :: A</SegmentedControl.Item>
            <SegmentedControl.Item value="cloze">Cloze</SegmentedControl.Item>
          </SegmentedControl.Root>

          {lines.length > 0 ? (
            <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: 340 }}>
              <Flex direction="column" gap="2" pr="2">
                {lines.map((line, i) => (
                  <label key={i} className={`srs-generate-row ${picked.has(i) ? 'selected' : ''}`}>
                    <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                    <span className="quiz-md">
                      <QuizMarkdown inline>{line}</QuizMarkdown>
                    </span>
                  </label>
                ))}
              </Flex>
            </ScrollArea>
          ) : null}
          {error ? (
            <Text size="2" color="red">
              {error}
            </Text>
          ) : null}

          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" onClick={onCancel}>
              Cancel
            </Button>
            {status === 'done' && lines.length > 0 ? (
              <>
                <Button variant="soft" color="gray" onClick={() => void generate()}>
                  Regenerate
                </Button>
                <Button
                  highContrast
                  disabled={picked.size === 0}
                  onClick={() => onInsert(lines.filter((_, i) => picked.has(i)))}
                >
                  Add {picked.size} card{picked.size === 1 ? '' : 's'}
                </Button>
              </>
            ) : (
              <Button highContrast loading={status === 'running'} onClick={() => void generate()}>
                <LightningBoltIcon />
                Generate
              </Button>
            )}
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}
