import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '@radix-ui/themes';
import { Cross1Icon, ExternalLinkIcon, Pencil1Icon, ResetIcon } from '@radix-ui/react-icons';
import type { QuizQuestion } from '../quiz/types';
import { noteTitle } from '../vault/fileTree';
import { CardEditor } from './CardEditor';
import { CardFace, mcqOptions as shuffledMcqOptions, suggestedRating, type FaceState } from './CardFace';
import { canEditCard, type CardEdit } from './editCard';
import type { ReviewSession } from './ReviewSession';
import { formatInterval, type Scheduler } from './scheduler';
import type { ReviewStateStore } from './ReviewStateStore';
import type { Rating, ReviewCard } from './types';
import { RATINGS } from './types';

const RATING_LABEL: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

type Props = {
  session: ReviewSession;
  deckLabel: string;
  store: ReviewStateStore;
  scheduler: Scheduler;
  typeCloze: boolean;
  onExit: () => void;
  onOpenSource: (card: ReviewCard) => void;
  /** Rewrite a card in its note. Resolves to an error message, or null once saved. */
  onEditCard: (card: ReviewCard, edit: CardEdit) => Promise<string | null>;
  /** The quiz question behind a quiz card, for editing it. */
  quizQuestionFor: (card: ReviewCard) => QuizQuestion | null;
};

function freshFace(): FaceState {
  return { revealed: false, seed: String(Date.now()), selected: [], typed: '' };
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || Boolean(el?.isContentEditable);
}

/** Full-width review: one card, reveal, rate. Everything is reachable from the keyboard. */
export function ReviewView({
  session,
  deckLabel,
  store,
  scheduler,
  typeCloze,
  onExit,
  onOpenSource,
  onEditCard,
  quizQuestionFor,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [face, setFace] = useState<FaceState>(freshFace);
  const [, setTick] = useState(0);
  /** Open editor; `question` is set when the card comes from a quiz. */
  const [editing, setEditing] = useState<{ question: QuizQuestion | null } | null>(null);
  const card = session.current(now);
  const editable = card ? canEditCard(card) : false;
  const counts = session.counts();
  const total = session.reviewed + counts.newCount + counts.learning + counts.review;
  const progress = total ? session.reviewed / total : 1;

  // Nothing showable yet but learning cards are waiting: wake up when one is due.
  const nextDue = card ? null : session.nextLearningDue();
  useEffect(() => {
    if (nextDue === null) return;
    const wait = Math.max(1000, nextDue - Date.now() - 20 * 60_000);
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait, 60_000));
    return () => window.clearTimeout(timer);
  }, [nextDue, now]);

  const preview = useMemo(
    () => (card ? scheduler.preview(store.get(card.id)?.sched, Date.now()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute per card/reveal
    [card?.id, face.revealed, scheduler],
  );

  const reveal = useCallback(() => {
    if (!card || face.revealed) return;
    if (card.kind === 'mcq' && face.selected.length === 0) return;
    setFace((current) => ({ ...current, revealed: true }));
  }, [card, face.revealed, face.selected.length]);

  const rate = useCallback(
    (rating: Rating) => {
      if (!card || !face.revealed) return;
      const at = Date.now();
      session.rate(card, rating, at);
      setFace(freshFace());
      setNow(at);
    },
    [card, face.revealed, session],
  );

  const undo = useCallback(() => {
    if (!session.canUndo()) return;
    session.undo();
    setFace(freshFace());
    setNow(Date.now());
    setTick((n) => n + 1);
  }, [session]);

  const toggleOption = useCallback(
    (id: string) => {
      if (!card || card.kind !== 'mcq' || face.revealed) return;
      const multi = card.question.options.filter((o) => o.correct).length > 1;
      setFace((current) => ({
        ...current,
        selected: multi
          ? current.selected.includes(id)
            ? current.selected.filter((other) => other !== id)
            : [...current.selected, id]
          : [id],
      }));
    },
    [card, face.revealed],
  );

  const startEdit = useCallback(() => {
    if (!card || !canEditCard(card)) return;
    if (card.source.origin !== 'quiz') {
      setEditing({ question: null });
      return;
    }
    const question = quizQuestionFor(card);
    // The quiz changed under us: fall back to opening it.
    if (question) setEditing({ question });
    else onOpenSource(card);
  }, [card, onOpenSource, quizQuestionFor]);

  const saveEdit = useCallback(
    async (edit: CardEdit) => {
      if (!card) return null;
      const error = await onEditCard(card, edit);
      if (error) return error;
      // The edited card keeps its place (and whether its answer is showing).
      setEditing(null);
      setTick((n) => n + 1);
      return null;
    },
    [card, onEditCard],
  );

  const mcqOptions = useMemo(() => (card?.kind === 'mcq' ? shuffledMcqOptions(card, face.seed) : []), [card, face.seed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor handles its own keys (Esc cancels the edit, not the review).
      if (editing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          undo();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
        return;
      }
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'u') {
        event.preventDefault();
        undo();
        return;
      }
      if (!card) return;
      if (key === 'o' || (key === 'e' && !canEditCard(card))) {
        event.preventDefault();
        onOpenSource(card);
        return;
      }
      if (key === 'e') {
        event.preventDefault();
        startEdit();
        return;
      }
      if (!face.revealed) {
        if (card.kind === 'mcq') {
          const byLetter = mcqOptions.find((o) => o.letter.toLowerCase() === key);
          const byNumber = /^[1-9]$/.test(key) ? mcqOptions[Number(key) - 1] : undefined;
          const option = byLetter ?? byNumber;
          if (option) {
            event.preventDefault();
            toggleOption(option.id);
            return;
          }
        }
        if (key === ' ' || key === 'enter') {
          event.preventDefault();
          reveal();
        }
        return;
      }
      const index = ['1', '2', '3', '4'].indexOf(key);
      if (index >= 0) {
        event.preventDefault();
        rate(RATINGS[index]);
        return;
      }
      if (key === ' ' || key === 'enter') {
        event.preventDefault();
        rate(suggestedRating(card, face, typeCloze));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, editing, face, mcqOptions, onExit, onOpenSource, rate, reveal, startEdit, toggleOption, typeCloze, undo]);

  const queue = card ? session.queueOf(card.id) : null;
  const suggested = card && face.revealed ? suggestedRating(card, face, typeCloze) : null;

  return (
    <div className="srs-review">
      <header className="srs-review-head">
        <div className="srs-review-title">
          <span className="srs-review-deck">{deckLabel}</span>
          <span className="srs-counts" aria-label="Cards left">
            <span className={`srs-count-new ${queue === 'new' ? 'current' : ''}`} title="New">{counts.newCount}</span>
            <span className={`srs-count-learning ${queue === 'learning' ? 'current' : ''}`} title="Learning">{counts.learning}</span>
            <span className={`srs-count-review ${queue === 'review' ? 'current' : ''}`} title="To review">{counts.review}</span>
          </span>
        </div>
        <div className="srs-review-tools">
          <IconButton size="1" variant="ghost" color="gray" aria-label="Undo last rating (U)" title="Undo (U)" disabled={!session.canUndo()} onClick={undo}>
            <ResetIcon />
          </IconButton>
          <IconButton size="1" variant="ghost" color="gray" aria-label="Exit review (Esc)" title="Exit (Esc)" onClick={onExit}>
            <Cross1Icon />
          </IconButton>
        </div>
      </header>
      <div className="srs-progress" aria-hidden>
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {card ? (
        <>
          <article className="srs-card" key={card.id}>
            <div className="srs-card-meta">
              <button type="button" className="srs-source" title="Open the note (O)" onClick={() => onOpenSource(card)}>
                {noteTitle(card.source.path)}
                <ExternalLinkIcon width={11} height={11} />
              </button>
              <span className="srs-card-meta-right">
                <span className="srs-kind">{card.kind === 'mcq' ? 'multiple choice' : card.kind}</span>
                {editable && !editing ? (
                  <button type="button" className="srs-edit" aria-label="Edit card (E)" title="Edit card (E)" onClick={startEdit}>
                    <Pencil1Icon width={13} height={13} />
                  </button>
                ) : null}
              </span>
            </div>
            {editing ? (
              <CardEditor card={card} question={editing.question} onSave={saveEdit} onCancel={() => setEditing(null)} />
            ) : (
              <CardFace
                card={card}
                state={face}
                typeCloze={typeCloze}
                onToggleOption={toggleOption}
                onTyped={(typed) => setFace((current) => ({ ...current, typed }))}
                onSubmit={() => (face.revealed ? rate(suggestedRating(card, face, typeCloze)) : reveal())}
              />
            )}
          </article>

          {editing ? null : (
            <>
              <footer className="srs-actions">
                {!face.revealed ? (
                  <Button size="3" highContrast className="srs-reveal" disabled={card.kind === 'mcq' && face.selected.length === 0} onClick={reveal}>
                    {card.kind === 'mcq' ? 'Check' : 'Show answer'}
                    <kbd>Space</kbd>
                  </Button>
                ) : (
                  <div className="srs-ratings">
                    {RATINGS.map((rating, index) => (
                      <button
                        key={rating}
                        type="button"
                        className={`srs-rate srs-rate-${rating} ${suggested === rating ? 'suggested' : ''}`}
                        onClick={() => rate(rating)}
                      >
                        <span className="srs-rate-interval">{preview ? formatInterval(preview[rating] - Date.now()) : ''}</span>
                        <span className="srs-rate-label">{RATING_LABEL[rating]}</span>
                        <kbd>{index + 1}</kbd>
                      </button>
                    ))}
                  </div>
                )}
              </footer>
              <p className="srs-hints">
                {face.revealed ? 'Space picks the highlighted rating · ' : ''}U undo · {editable ? 'E edit · ' : ''}O open note · Esc exit
              </p>
            </>
          )}
        </>
      ) : (
        <div className="srs-done">
          <strong>{session.reviewed ? 'Session complete' : 'Nothing due'}</strong>
          <span>
            {session.reviewed
              ? `${session.reviewed} review${session.reviewed === 1 ? '' : 's'} done.`
              : 'No cards in this deck need review right now.'}
          </span>
          {nextDue !== null ? (
            <span className="srs-muted">
              {counts.learning} card{counts.learning === 1 ? '' : 's'} still learning — back in{' '}
              {formatInterval(Math.max(0, nextDue - Date.now()))}. Keep this open or come back later.
            </span>
          ) : null}
          <div className="srs-done-actions">
            {session.canUndo() ? (
              <Button variant="soft" color="gray" onClick={undo}>
                Undo last
              </Button>
            ) : null}
            <Button highContrast onClick={onExit}>
              Back to notes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
