import { useMemo, useState } from 'react';
import { Button, IconButton, SegmentedControl, Text, TextArea, TextField } from '@radix-ui/themes';
import { Cross1Icon, LightningBoltIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import type { AiClient } from '../ai/AiClient';
import { QuizMarkdown } from '../quiz/QuizMarkdown';
import { noteTitle } from '../vault/fileTree';
import {
  formatBasicCardLine,
  formatClozeCardLine,
  formatMcqCardBlock,
} from './appendCardLines';
import {
  buildCardGenerationPrompt,
  cardBlocksFromModel,
  completeCardGeneration,
  existingCardSummaries,
  type CardStyle,
} from './cardGeneration';
import type { ParsedMcqOption } from './parseNoteCards';

type Mode = 'basic' | 'cloze' | 'mcq';

type Props = {
  client: AiClient;
  path: string;
  content: string;
  onInsert: (blocks: string[]) => void | Promise<void>;
  onClose: () => void;
};

function blankOptions(): ParsedMcqOption[] {
  return [
    { text: '', correct: true },
    { text: '', correct: false },
    { text: '', correct: false },
  ];
}

/** Half-panel composer: manual cards + optional on-demand AI from a rough concept. */
export function CreateCardsPanel({ client, path, content, onInsert, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [cloze, setCloze] = useState('');
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState<ParsedMcqOption[]>(blankOptions);
  const [manualError, setManualError] = useState('');

  const [aiOpen, setAiOpen] = useState(false);
  const [concept, setConcept] = useState('');
  const [aiStyle, setAiStyle] = useState<CardStyle>('mixed');
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const existing = useMemo(() => existingCardSummaries(content), [content]);

  const resetManual = (next: Mode) => {
    setMode(next);
    setManualError('');
    setFront('');
    setBack('');
    setCloze('');
    setMcqPrompt('');
    setMcqOptions(blankOptions());
  };

  const addManual = async () => {
    setManualError('');
    let block = '';
    if (mode === 'basic') {
      if (!front.trim() || !back.trim()) {
        setManualError('Add both a front and a back.');
        return;
      }
      block = formatBasicCardLine(front, back);
    } else if (mode === 'cloze') {
      if (!cloze.trim()) {
        setManualError('Add cloze text with at least one {{blank}}.');
        return;
      }
      if (!/\{\{[^}]+\}\}/.test(cloze)) {
        setManualError('Wrap the hidden answer in {{…}}.');
        return;
      }
      block = formatClozeCardLine(cloze);
    } else {
      const options = mcqOptions.map((option) => ({ text: option.text.trim(), correct: option.correct })).filter((option) => option.text);
      if (!mcqPrompt.trim()) {
        setManualError('Add a question.');
        return;
      }
      if (options.length < 2) {
        setManualError('Add at least two options.');
        return;
      }
      if (!options.some((option) => option.correct)) {
        setManualError('Mark at least one option as correct.');
        return;
      }
      block = formatMcqCardBlock(mcqPrompt, options);
    }
    await onInsert([block]);
    resetManual(mode);
  };

  const generate = async () => {
    const idea = concept.trim();
    if (!idea) {
      setAiError('Type a concept or draft in the box first.');
      setAiStatus('error');
      return;
    }
    setAiStatus('running');
    setAiError('');
    try {
      const reply = await completeCardGeneration(client, {
        prompt: buildCardGenerationPrompt(aiStyle, idea, existing),
        context: content,
      });
      const found = cardBlocksFromModel(reply);
      setSuggestions(found);
      setPicked(new Set(found.map((_, i) => i)));
      setAiStatus('done');
      if (found.length === 0) {
        setAiError('Qwen Flash did not return any cards. Check OpenRouter in Settings and try again.');
      }
    } catch (err) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : 'Card generation failed. Check OpenRouter in Settings.');
    }
  };

  const togglePick = (index: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const addSelected = async () => {
    const blocks = suggestions.filter((_, i) => picked.has(i));
    if (blocks.length === 0) return;
    await onInsert(blocks);
    setSuggestions([]);
    setPicked(new Set());
    setAiStatus('idle');
  };

  return (
    <div className="srs-create-panel">
      <div className="sidebar-heading">
        <Text size="1" color="gray" weight="bold">
          CREATE CARDS
        </Text>
        <IconButton type="button" size="1" variant="ghost" color="gray" aria-label="Close create cards" onClick={onClose}>
          <Cross1Icon />
        </IconButton>
      </div>

      <div className="srs-create-body">
        <Text size="1" color="gray" className="srs-create-sub">
          Into “{noteTitle(path)}” · stays in this note
        </Text>

        <SegmentedControl.Root value={mode} onValueChange={(value) => resetManual(value as Mode)} size="1">
          <SegmentedControl.Item value="basic">Front / Back</SegmentedControl.Item>
          <SegmentedControl.Item value="cloze">Cloze</SegmentedControl.Item>
          <SegmentedControl.Item value="mcq">MCQ</SegmentedControl.Item>
        </SegmentedControl.Root>

        <div className="srs-create-form">
          {mode === 'basic' ? (
            <>
              <label className="srs-create-label">
                <span className="srs-create-caption">Front</span>
                <TextArea size="2" resize="vertical" rows={2} value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question" />
              </label>
              <label className="srs-create-label">
                <span className="srs-create-caption">Back</span>
                <TextArea size="2" resize="vertical" rows={3} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Answer" />
              </label>
            </>
          ) : null}
          {mode === 'cloze' ? (
            <label className="srs-create-label">
              <span className="srs-create-caption">Text</span>
              <TextArea
                size="2"
                resize="vertical"
                rows={4}
                value={cloze}
                onChange={(e) => setCloze(e.target.value)}
                placeholder="The {{mitochondria}} produces ATP."
              />
            </label>
          ) : null}
          {mode === 'mcq' ? (
            <>
              <label className="srs-create-label">
                <span className="srs-create-caption">Question</span>
                <TextArea
                  size="2"
                  resize="vertical"
                  rows={2}
                  value={mcqPrompt}
                  onChange={(e) => setMcqPrompt(e.target.value)}
                  placeholder="What layer handles retransmission?"
                />
              </label>
              <div className="srs-create-options">
                {mcqOptions.map((option, index) => (
                  <div key={index} className="srs-create-option">
                    <input
                      type="checkbox"
                      checked={option.correct}
                      aria-label={`Mark option ${index + 1} correct`}
                      onChange={(e) =>
                        setMcqOptions((current) =>
                          current.map((row, i) => (i === index ? { ...row, correct: e.target.checked } : row)),
                        )
                      }
                    />
                    <TextField.Root
                      size="2"
                      value={option.text}
                      placeholder={`Option ${index + 1}`}
                      onChange={(e) =>
                        setMcqOptions((current) =>
                          current.map((row, i) => (i === index ? { ...row, text: e.target.value } : row)),
                        )
                      }
                    />
                    <IconButton
                      type="button"
                      size="1"
                      variant="ghost"
                      color="gray"
                      disabled={mcqOptions.length <= 2}
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() => setMcqOptions((current) => current.filter((_, i) => i !== index))}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                ))}
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => setMcqOptions((current) => [...current, { text: '', correct: false }])}
                >
                  <PlusIcon />
                  Option
                </Button>
              </div>
            </>
          ) : null}

          {manualError ? (
            <Text size="1" color="red">
              {manualError}
            </Text>
          ) : null}

          <Button highContrast size="2" onClick={() => void addManual()}>
            Add to note
          </Button>
        </div>

        <div className="srs-create-ai">
          <button type="button" className="srs-create-ai-toggle" onClick={() => setAiOpen((open) => !open)}>
            <LightningBoltIcon width={14} height={14} />
            <span>AI assist</span>
            <span className="srs-muted">{aiOpen ? 'Hide' : 'Show'}</span>
          </button>

          {aiOpen ? (
            <div className="srs-create-ai-body">
              <Text size="1" color="gray">
                Type a concept or rough draft — Qwen Flash turns that text into cards when you click Generate.
              </Text>
              <TextArea
                size="2"
                resize="vertical"
                rows={4}
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Paste notes or a rough idea, e.g. TCP congestion control — slow start doubles the window each RTT until ssthresh, then AIMD…"
              />
              <SegmentedControl.Root value={aiStyle} onValueChange={(value) => setAiStyle(value as CardStyle)} size="1">
                <SegmentedControl.Item value="mixed">Mixed</SegmentedControl.Item>
                <SegmentedControl.Item value="basic">Q :: A</SegmentedControl.Item>
                <SegmentedControl.Item value="cloze">Cloze</SegmentedControl.Item>
                <SegmentedControl.Item value="mcq">MCQ</SegmentedControl.Item>
              </SegmentedControl.Root>

              {suggestions.length > 0 ? (
                <ul className="srs-create-suggestions">
                  {suggestions.map((block, index) => (
                    <li key={index}>
                      <label className={`srs-generate-row ${picked.has(index) ? 'selected' : ''}`}>
                        <input type="checkbox" checked={picked.has(index)} onChange={() => togglePick(index)} />
                        <span className="quiz-md">
                          <QuizMarkdown>{block}</QuizMarkdown>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}

              {aiError ? (
                <Text size="1" color="red">
                  {aiError}
                </Text>
              ) : null}

              <div className="srs-create-ai-actions">
                {suggestions.length > 0 && aiStatus !== 'running' ? (
                  <>
                    <Button size="1" variant="soft" color="gray" onClick={() => void generate()}>
                      Regenerate
                    </Button>
                    <Button size="1" highContrast disabled={picked.size === 0} onClick={() => void addSelected()}>
                      Add {picked.size} selected
                    </Button>
                  </>
                ) : (
                  <Button
                    size="1"
                    highContrast
                    loading={aiStatus === 'running'}
                    disabled={!concept.trim()}
                    onClick={() => void generate()}
                  >
                    <LightningBoltIcon />
                    Generate
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
