import { useMemo } from 'react';
import { QuizMarkdown } from '../quiz/QuizMarkdown';
import { createRng, hashSeed, optionLetter, shuffledCopy } from '../quiz/shuffle';
import { clozeDisplaySegments } from './parseNoteCards';
import type { ClozeCard, McqCard, ReviewCard } from './types';

/** Loose answer match for typed cloze answers: case, spacing and trailing punctuation don't matter. */
export function answersMatch(typed: string, expected: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?'"`]+/g, ' ').trim();
  return norm(typed) === norm(expected);
}

export function clozeAnswer(card: ClozeCard): string {
  return clozeDisplaySegments(card.text, card.group)
    .flatMap((seg) => (seg.type === 'blank' && seg.hidden ? [seg.answer] : []))
    .join(' · ');
}

/** Inline markdown that keeps the spaces at its edges (markdown would trim them). */
function InlineText({ text }: { text: string }) {
  const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ['', '', text, ''];
  return (
    <>
      {lead ? ' ' : null}
      {body ? <QuizMarkdown inline>{body}</QuizMarkdown> : null}
      {trail ? ' ' : null}
    </>
  );
}

function ClozeFace({
  card,
  revealed,
  typed,
  onTyped,
  onSubmit,
}: {
  card: ClozeCard;
  revealed: boolean;
  typed?: string;
  onTyped?: (value: string) => void;
  onSubmit?: () => void;
}) {
  const segments = clozeDisplaySegments(card.text, card.group);
  let inputShown = false;
  return (
    <div className="srs-cloze quiz-md">
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <InlineText key={i} text={seg.value} />;
        if (!seg.hidden) return <InlineText key={i} text={seg.answer} />;
        if (revealed) {
          return (
            <mark key={i} className="srs-cloze-answer">
              <QuizMarkdown inline>{seg.answer}</QuizMarkdown>
            </mark>
          );
        }
        // Typed mode: one input, on the first hidden blank of the group.
        if (onTyped && !inputShown) {
          inputShown = true;
          return (
            <input
              key={i}
              className="srs-cloze-input"
              autoFocus
              value={typed ?? ''}
              placeholder={seg.hint ?? ''}
              aria-label="Type the missing text"
              onChange={(event) => onTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSubmit?.();
                }
              }}
            />
          );
        }
        return (
          <span key={i} className="srs-cloze-blank">
            [{seg.hint ?? '…'}]
          </span>
        );
      })}
    </div>
  );
}

/** Options in a per-showing shuffled order, lettered after the shuffle (like quizzes). */
export function mcqOptions(card: McqCard, seed: string) {
  const rng = createRng(hashSeed(`${card.id}:${seed}`));
  return shuffledCopy(card.question.options, rng).map((option, index) => ({ ...option, letter: optionLetter(index) }));
}

function McqFace({
  card,
  seed,
  revealed,
  selected,
  onToggle,
}: {
  card: McqCard;
  seed: string;
  revealed: boolean;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const options = useMemo(() => mcqOptions(card, seed), [card, seed]);
  const multi = card.question.options.filter((option) => option.correct).length > 1;
  return (
    <div className="quiz-mcq">
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{card.question.prompt}</QuizMarkdown>
      </div>
      {multi ? <p className="srs-muted">Select all that apply.</p> : null}
      <div className="quiz-options" role={multi ? 'group' : 'radiogroup'}>
        {options.map((option) => {
          const checked = selected.includes(option.id);
          const verdict = revealed ? (option.correct ? 'srs-correct' : checked ? 'srs-wrong' : '') : '';
          return (
            <label key={option.id} className={`quiz-option ${checked ? 'selected' : ''} ${verdict}`}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={card.id}
                checked={checked}
                disabled={revealed}
                onChange={() => onToggle(option.id)}
              />
              <span className="quiz-option-letter">{option.letter}</span>
              <span className="quiz-md quiz-option-text">
                <QuizMarkdown inline>{option.text}</QuizMarkdown>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export type FaceState = {
  revealed: boolean;
  seed: string;
  selected: string[];
  typed: string;
};

export function CardFace({
  card,
  state,
  typeCloze,
  onToggleOption,
  onTyped,
  onSubmit,
}: {
  card: ReviewCard;
  state: FaceState;
  typeCloze: boolean;
  onToggleOption: (id: string) => void;
  onTyped: (value: string) => void;
  onSubmit: () => void;
}) {
  if (card.kind === 'mcq') {
    return <McqFace card={card} seed={state.seed} revealed={state.revealed} selected={state.selected} onToggle={onToggleOption} />;
  }
  if (card.kind === 'cloze') {
    const answer = clozeAnswer(card);
    const typedVerdict =
      typeCloze && state.revealed ? (answersMatch(state.typed, answer) ? 'correct' : 'wrong') : null;
    return (
      <>
        <ClozeFace
          card={card}
          revealed={state.revealed}
          typed={state.typed}
          onTyped={typeCloze ? onTyped : undefined}
          onSubmit={onSubmit}
        />
        {typedVerdict ? (
          <p className={`srs-typed-verdict srs-typed-${typedVerdict}`}>
            {typedVerdict === 'correct' ? '✓ ' : '✗ '}
            You typed <strong>{state.typed.trim() || '(nothing)'}</strong>
          </p>
        ) : null}
      </>
    );
  }
  return (
    <>
      <div className="srs-front quiz-md">
        <QuizMarkdown>{card.front}</QuizMarkdown>
      </div>
      {state.revealed ? (
        <>
          <hr className="srs-divider" />
          <div className="srs-back quiz-md">
            <QuizMarkdown>{card.back}</QuizMarkdown>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Rating to suggest after reveal (what Space/Enter picks). */
export function suggestedRating(card: ReviewCard, state: FaceState, typeCloze: boolean): 'again' | 'good' {
  if (card.kind === 'mcq') {
    const correct = new Set(card.question.options.filter((o) => o.correct).map((o) => o.id));
    const picked = new Set(state.selected);
    const right = correct.size === picked.size && [...correct].every((id) => picked.has(id));
    return right ? 'good' : 'again';
  }
  if (card.kind === 'cloze' && typeCloze) {
    return answersMatch(state.typed, clozeAnswer(card)) ? 'good' : 'again';
  }
  return 'good';
}
