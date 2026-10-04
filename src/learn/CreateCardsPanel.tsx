import { useState } from 'react';
import { Button, IconButton, SegmentedControl, Text, TextArea, TextField } from '@radix-ui/themes';
import { Cross1Icon, LightningBoltIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import type { AiClient } from '../ai/AiClient';
import { noteTitle } from '../vault/fileTree';
import {
  formatBasicCardLine,
  formatClozeCardLine,
  formatMcqCardBlock,
} from './appendCardLines';
import {
  buildBasicFillPrompt,
  completeCardGeneration,
  parseFillReply,
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

/** Half-panel composer: type Front or Back, Generate fills the other side with Qwen Flash. */
export function CreateCardsPanel({ client, path, content, onInsert, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [cloze, setCloze] = useState('');
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState<ParsedMcqOption[]>(blankOptions);
  const [manualError, setManualError] = useState('');
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiOk, setAiOk] = useState('');

  const resetManual = (next: Mode) => {
    setMode(next);
    setManualError('');
    setAiError('');
    setAiOk('');
    setFront('');
    setBack('');
    setCloze('');
    setMcqPrompt('');
    setMcqOptions(blankOptions());
    setAiStatus('idle');
  };

  const addManual = async () => {
    setManualError('');
    setAiOk('');
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
    setAiOk('Added to note');
  };

  const generate = async () => {
    setManualError('');
    setAiError('');
    setAiOk('');

    if (mode !== 'basic') {
      setAiError('Generate currently fills Front ↔ Back. Switch to Front / Back.');
      setAiStatus('error');
      return;
    }

    const frontText = front.trim();
    const backText = back.trim();
    if (!frontText && !backText) {
      setAiError('Type something in Front or Back first.');
      setAiStatus('error');
      return;
    }
    if (frontText && backText) {
      setAiError('Clear Front or Back so Generate knows which side to fill.');
      setAiStatus('error');
      return;
    }

    const kind = frontText ? 'answer' : 'question';
    const source = frontText || backText;
    setAiStatus('running');
    try {
      const reply = await completeCardGeneration(client, {
        prompt: buildBasicFillPrompt(kind, source),
        context: content,
      });
      const filled = parseFillReply(reply);
      if (!filled) {
        setAiStatus('error');
        setAiError('Qwen Flash returned an empty answer. Try again.');
        return;
      }
      if (kind === 'answer') {
        setBack(filled);
        setAiOk('Filled Back');
      } else {
        setFront(filled);
        setAiOk('Filled Front');
      }
      setAiStatus('done');
    } catch (err) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : 'Card generation failed. Check OpenRouter in Settings.');
    }
  };

  const canGenerate =
    mode === 'basic' &&
    ((Boolean(front.trim()) && !back.trim()) || (!front.trim() && Boolean(back.trim())));

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

          {manualError || aiError ? (
            <Text size="1" color="red">
              {manualError || aiError}
            </Text>
          ) : null}
          {aiOk && !manualError && !aiError ? (
            <Text size="1" color="green">
              {aiOk}
            </Text>
          ) : null}

          <div className="srs-create-actions">
            <Button
              size="2"
              variant="soft"
              color="gray"
              loading={aiStatus === 'running'}
              disabled={!canGenerate || aiStatus === 'running'}
              onClick={() => void generate()}
            >
              <LightningBoltIcon />
              Generate
            </Button>
            <Button highContrast size="2" onClick={() => void addManual()}>
              Add to note
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
