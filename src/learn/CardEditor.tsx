import { useState } from 'react';
import { Button } from '@radix-ui/themes';
import type { QuizQuestion } from '../quiz/types';
import type { CardEdit } from './editCard';
import type { ReviewCard } from './types';

type Props = {
  card: ReviewCard;
  /** Set for cards from a quiz file: the question is edited instead of the card text. */
  question: QuizQuestion | null;
  onSave: (edit: CardEdit) => Promise<string | null>;
  onCancel: () => void;
};

type Field = { key: string; label: string; value: string; minRows: number };

/** Editable text fields for a card, in display order. */
function initialFields(card: ReviewCard, question: QuizQuestion | null): Field[] {
  const field = (key: string, label: string, value: string | undefined, minRows = 2): Field => ({ key, label, value: value ?? '', minRows });
  const lines = (items?: string[]) => (items ?? []).join('\n');
  if (question) {
    switch (question.type) {
      case 'open':
        return [
          field('prompt', 'Question', question.prompt),
          field('answer', 'Answer', question.answer, 3),
          field('keyPoints', 'Key points — one per line', lines(question.keyPoints)),
        ];
      case 'code':
        return [
          field('prompt', 'Question', question.prompt),
          field('snippet', `Code (${question.language})`, question.snippet, 3),
          field('expected', question.kind === 'predict-output' ? 'Expected output' : 'Answer', question.expected, 3),
          field('keyPoints', 'Key points — one per line', lines(question.keyPoints)),
          field('explanation', 'Why (optional)', question.explanation),
        ];
      case 'cloze':
        return [
          field('prompt', 'Text — wrap answers in {{…}}', question.prompt, 3),
          field('explanation', 'Explanation (optional)', question.explanation),
        ];
      case 'mcq':
        return [
          field('prompt', 'Question', question.prompt),
          field('options', 'Options — one per line, mark correct ones with [x]', question.options.map((o) => `[${o.correct ? 'x' : ' '}] ${o.text}`).join('\n'), 3),
        ];
    }
  }
  if (card.kind === 'basic') return [field('front', 'Front', card.front), field('back', 'Back', card.back, 3)];
  if (card.kind === 'cloze') return [field('text', 'Text — wrap answers in {{…}}', card.text, 3)];
  if (card.kind === 'mcq') {
    return [
      field('prompt', 'Question', card.question.prompt),
      field(
        'options',
        'Options — one per line, mark correct ones with [x]',
        card.question.options.map((o) => `[${o.correct ? 'x' : ' '}] ${o.text}`).join('\n'),
        3,
      ),
    ];
  }
  return [];
}

function parseOptionLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
    .filter(Boolean)
    .map((line, i) => {
      const mark = /^\[([ xX]?)\]\s*/.exec(line);
      return {
        id: `opt-${i + 1}`,
        text: mark ? line.slice(mark[0].length) : line,
        correct: mark?.[1].toLowerCase() === 'x',
      };
    });
}

function toEdit(card: ReviewCard, question: QuizQuestion | null, values: Record<string, string>): CardEdit {
  const list = (text: string) => text.split('\n').map((line) => line.replace(/^\s*[-*+]\s+/, '').trim()).filter(Boolean);
  if (question) {
    switch (question.type) {
      case 'open':
        return { kind: 'quiz', question: { ...question, prompt: values.prompt, answer: values.answer, keyPoints: list(values.keyPoints) } };
      case 'code':
        return {
          kind: 'quiz',
          question: { ...question, prompt: values.prompt, snippet: values.snippet, expected: values.expected, keyPoints: list(values.keyPoints), explanation: values.explanation },
        };
      case 'cloze':
        return { kind: 'quiz', question: { ...question, prompt: values.prompt, explanation: values.explanation } };
      case 'mcq':
        return {
          kind: 'quiz',
          question: {
            ...question,
            prompt: values.prompt,
            options: parseOptionLines(values.options).map((option, i) => ({
              ...option,
              id: `${question.id}-opt-${i + 1}`,
            })),
          },
        };
    }
  }
  if (card.kind === 'basic') return { kind: 'basic', front: values.front, back: values.back };
  if (card.kind === 'cloze') return { kind: 'cloze', text: values.text };
  return {
    kind: 'mcq',
    prompt: values.prompt,
    options: parseOptionLines(values.options).map(({ text, correct }) => ({ text, correct })),
  };
}

/** Edit a card's text in place during review; saving rewrites its note or quiz and keeps its history. */
export function CardEditor({ card, question, onSave, onCancel }: Props) {
  const [fields] = useState(() => initialFields(card, question));
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const failure = await onSave(toEdit(card, question, values));
    setSaving(false);
    setError(failure);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  // Answers are what usually need trimming, so start there.
  const focusKey = fields.find((f) => ['back', 'answer', 'expected', 'text'].includes(f.key))?.key ?? fields[0]?.key;

  return (
    <div className="srs-editor" onKeyDown={onKeyDown}>
      {fields.map((field) => (
        <div key={field.key} className="srs-editor-row">
          <label className="srs-editor-label" htmlFor={`srs-edit-${field.key}`}>
            {field.label}
          </label>
          <textarea
            id={`srs-edit-${field.key}`}
            className="srs-editor-field"
            autoFocus={field.key === focusKey}
            spellCheck={field.key !== 'snippet'}
            value={values[field.key]}
            rows={Math.min(14, Math.max(field.minRows, values[field.key].split('\n').length + 1))}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
          />
        </div>
      ))}
      {error ? <p className="srs-editor-error">{error}</p> : null}
      <div className="srs-editor-actions">
        <span className="srs-muted">Saved to the {question ? 'quiz' : 'note'} · review history is kept</span>
        <Button size="1" variant="soft" color="gray" onClick={onCancel}>
          Cancel <kbd>Esc</kbd>
        </Button>
        <Button size="1" highContrast disabled={saving} onClick={() => void save()}>
          Save <kbd>⌘↵</kbd>
        </Button>
      </div>
    </div>
  );
}
