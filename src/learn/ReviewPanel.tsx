import { useEffect, useState } from 'react';
import type { CardStore } from './CardStore';
import type { ReviewQueue } from './ReviewQueue';
import type { Flashcard, Rating } from './types';

const RATINGS: { id: Rating; label: string }[] = [
  { id: 'again', label: 'Again' },
  { id: 'hard', label: 'Hard' },
  { id: 'good', label: 'Good' },
  { id: 'easy', label: 'Easy' },
];

type Props = {
  store: CardStore;
  queue: ReviewQueue;
  onStartQuiz?: (cards: Flashcard[]) => void;
};

/**
 * Compact review UI — mount in the right panel or a modal.
 */
export function ReviewPanel({ store, queue, onStartQuiz }: Props) {
  const [, setTick] = useState(0);
  const [active, setActive] = useState<Flashcard | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    void store.load().then(() => setTick((n) => n + 1));
    return store.subscribe(() => setTick((n) => n + 1));
  }, [store]);

  const due = queue.dueCards();

  const begin = () => {
    const next = queue.dueCards()[0] ?? null;
    setActive(next);
    setRevealed(false);
  };

  const rate = (rating: Rating) => {
    if (!active) return;
    queue.rate(active.id, rating);
    const remaining = queue.dueCards().filter((c) => c.id !== active.id);
    const next = remaining[0] ?? null;
    setActive(next);
    setRevealed(false);
    setTick((n) => n + 1);
  };

  if (active) {
    return (
      <div className="mv-review-panel">
        <div className="mv-panel-label">REVIEW</div>
        <div className="mv-card-face">
          <strong>{active.front}</strong>
          {revealed ? <p>{active.back}</p> : null}
        </div>
        {!revealed ? (
          <button type="button" className="mv-btn" onClick={() => setRevealed(true)}>
            Show answer
          </button>
        ) : (
          <div className="mv-rating-row">
            {RATINGS.map((r) => (
              <button key={r.id} type="button" className="mv-btn mv-btn-sm" onClick={() => rate(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="mv-link" onClick={() => setActive(null)}>
          Exit review
        </button>
      </div>
    );
  }

  return (
    <div className="mv-review-panel">
      <div className="mv-panel-label">REVIEW</div>
      <div className="review-card">
        <div className="review-number">{due.length}</div>
        <div>
          <strong>Cards due</strong>
          <small>{due.length === 0 ? 'Nothing due right now' : 'Ready to study'}</small>
        </div>
      </div>
      <div className="mv-actions">
        <button type="button" className="mv-btn" disabled={due.length === 0} onClick={begin}>
          Review now
        </button>
        {onStartQuiz ? (
          <button
            type="button"
            className="mv-btn mv-btn-ghost"
            disabled={due.length === 0}
            onClick={() => onStartQuiz(due)}
          >
            Quiz mode
          </button>
        ) : null}
      </div>
      <small className="mv-muted">{store.getAll().length} cards in vault</small>
    </div>
  );
}
