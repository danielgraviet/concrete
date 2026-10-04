import { useMemo } from 'react';
import { Button } from '@radix-ui/themes';
import { PlusIcon } from '@radix-ui/react-icons';
import { queueCounts } from './ReviewSession';
import { State } from './scheduler';
import type { ReviewSystem } from './useReviewSystem';
import type { ReviewCard } from './types';

type Props = {
  system: ReviewSystem;
  path: string;
  onReview: () => void;
  onCreate?: () => void;
};

function cardLabel(card: ReviewCard): string {
  if (card.kind === 'basic') return card.front;
  if (card.kind === 'mcq') return card.question.prompt;
  return card.text.replace(/\{\{(?:c?\d+::)?((?:(?!\}\}).)+?)(?:::(?:(?!\}\}).)+?)?\}\}/g, '[$1]');
}

/** Right-panel summary of the open note's cards + entry to the create half-panel. */
export function NoteCardsPanel({ system, path, onReview, onCreate }: Props) {
  const { cards, store, settings, revision } = system;
  const summary = useMemo(() => {
    const mine = cards.filter((card) => card.source.path === path);
    const counts = queueCounts(mine, store, settings, Date.now());
    const learned = mine.filter((card) => (store.get(card.id)?.sched?.state ?? State.New) !== State.New).length;
    return { mine, counts, learned };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision covers store changes
  }, [cards, store, settings, path, revision]);

  const waiting = summary.counts.newCount + summary.counts.learning + summary.counts.review;

  return (
    <div className="srs-note-panel">
      <div className="panel-title">CARDS</div>
      {summary.mine.length === 0 ? (
        <p className="srs-muted">
          No cards in this note yet. Open Create cards to add Front/Back, Cloze, or MCQ — or write{' '}
          <code>Q :: A</code> / <code>{'{{blank}}'}</code> / <code>?mcq</code> in the note.
        </p>
      ) : (
        <>
          <p className="srs-note-summary">
            <strong>{summary.mine.length}</strong> card{summary.mine.length === 1 ? '' : 's'} · {summary.learned} learned
            {waiting ? ` · ${waiting} waiting` : ''}
          </p>
          <ul className="srs-note-cards">
            {summary.mine.slice(0, 6).map((card) => (
              <li key={card.id} title={cardLabel(card)}>
                {cardLabel(card)}
              </li>
            ))}
            {summary.mine.length > 6 ? <li className="srs-muted">+ {summary.mine.length - 6} more</li> : null}
          </ul>
        </>
      )}
      <div className="srs-note-actions">
        {onCreate ? (
          <Button size="1" highContrast onClick={onCreate}>
            <PlusIcon />
            Create cards
          </Button>
        ) : null}
        <Button size="1" variant="soft" color="gray" disabled={waiting === 0} onClick={onReview}>
          Review this note
        </Button>
      </div>
    </div>
  );
}
