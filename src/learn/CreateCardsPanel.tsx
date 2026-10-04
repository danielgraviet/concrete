import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, SegmentedControl, Text, TextArea, TextField } from '@radix-ui/themes';
import { CheckIcon, Cross1Icon, LightningBoltIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import type { AiClient } from '../ai/AiClient';
import { noteTitle } from '../vault/fileTree';
import {
  formatBasicCardLine,
  formatClozeCardLine,
  formatMcqCardBlock,
} from './appendCardLines';
import {
  buildBasicFillPrompt,
  buildClozeFillPrompt,
  buildMcqFillPrompt,
  completeCardGeneration,
  parseClozeFillReply,
  parseFillReply,
  parseMcqOptionsReply,
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Half-panel composer: Generate fills the missing side / options / cloze via Cerebras. */
export function CreateCardsPanel({ client, path, content, onInsert, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [cloze, setCloze] = useState('');
  const [mcqPrompt, setMcqPrompt] = useState('');
  const [mcqOptions, setMcqOptions] = useState<ParsedMcqOption[]>(blankOptions);
  const [manualError, setManualError] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [statusOk, setStatusOk] = useState('');
  const statusTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    };
  }, []);

  const showOk = (message: string) => {
    setStatusOk(message);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatusOk(''), 2500);
  };

  const clearFields = () => {
    setFront('');
    setBack('');
    setCloze('');
    setMcqPrompt('');
    setMcqOptions(blankOptions());
  };

  const resetManual = (next: Mode) => {
    setMode(next);
    setManualError('');
    setAiError('');
    setStatusOk('');
    clearFields();
    setAiStatus('idle');
  };

  const addManual = async () => {
    if (saving) return;
    setManualError('');
    setAiError('');
    setStatusOk('');
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

    setSaving(true);
    try {
      // Keep the spinner visible even when the write is instant.
      await Promise.all([onInsert([block]), wait(450)]);
      clearFields();
      setAiStatus('idle');
      showOk('Added to note');
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Could not add the card.');
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setManualError('');
    setAiError('');
    setStatusOk('');
    setAiStatus('running');

    try {
      if (mode === 'basic') {
        const frontText = front.trim();
        const backText = back.trim();
        if (!frontText && !backText) {
          setAiStatus('error');
          setAiError('Type something in Front or Back first.');
          return;
        }
        if (frontText && backText) {
          setAiStatus('error');
          setAiError('Clear Front or Back so Generate knows which side to fill.');
          return;
        }
        const kind = frontText ? 'answer' : 'question';
        const reply = await completeCardGeneration(client, {
          prompt: buildBasicFillPrompt(kind, frontText || backText),
          context: content,
        });
        const filled = parseFillReply(reply);
        if (!filled) {
          setAiStatus('error');
          setAiError('Model returned an empty answer. Try again.');
          return;
        }
        if (kind === 'answer') {
          setBack(filled);
          showOk('Filled Back');
        } else {
          setFront(filled);
          showOk('Filled Front');
        }
        setAiStatus('done');
        return;
      }

      if (mode === 'cloze') {
        const draft = cloze.trim();
        if (!draft) {
          setAiStatus('error');
          setAiError('Type a rough idea or sentence first.');
          return;
        }
        const reply = await completeCardGeneration(client, {
          prompt: buildClozeFillPrompt(draft),
          context: content,
        });
        const filled = parseClozeFillReply(reply);
        if (!filled) {
          setAiStatus('error');
          setAiError('Model did not return a cloze with {{blanks}}. Try again.');
          return;
        }
        setCloze(filled);
        showOk('Filled cloze');
        setAiStatus('done');
        return;
      }

      const question = mcqPrompt.trim();
      if (!question) {
        setAiStatus('error');
        setAiError('Type the MCQ question first.');
        return;
      }
      const reply = await completeCardGeneration(client, {
        prompt: buildMcqFillPrompt(question),
        context: content,
      });
      const options = parseMcqOptionsReply(reply);
      if (options.length === 0) {
        setAiStatus('error');
        setAiError('Model did not return valid MCQ options. Try again.');
        return;
      }
      setMcqOptions(options);
      showOk(`Filled ${options.length} options`);
      setAiStatus('done');
    } catch (err) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : 'Card generation failed. Check OpenRouter in Settings.');
    }
  };

  const canGenerate =
    mode === 'basic'
      ? (Boolean(front.trim()) && !back.trim()) || (!front.trim() && Boolean(back.trim()))
      : mode === 'cloze'
        ? Boolean(cloze.trim())
        : Boolean(mcqPrompt.trim());

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
                placeholder="Rough idea, or The {{mitochondria}} produces ATP."
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
                  placeholder="Type the question — Generate fills the options"
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
          {statusOk && !manualError && !aiError ? (
            <div className="srs-create-success" role="status" aria-live="polite">
              <CheckIcon width={14} height={14} />
              <span>{statusOk}</span>
            </div>
          ) : null}

          <div className="srs-create-actions">
            <Button
              size="2"
              variant="soft"
              color="gray"
              loading={aiStatus === 'running'}
              disabled={!canGenerate || aiStatus === 'running' || saving}
              onClick={() => void generate()}
            >
              <LightningBoltIcon />
              Generate
            </Button>
            <Button highContrast size="2" loading={saving} disabled={saving || aiStatus === 'running'} onClick={() => void addManual()}>
              {saving ? 'Adding…' : 'Add to note'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
