import { useEffect } from 'react';
import type { ReviewQueue } from './ReviewQueue';
import type { Flashcard, Rating } from './types';
import { useQuizSession } from './useQuizSession';

const RATINGS: { id: Rating; label: string }[] = [
  { id: 'again', label: 'Again' },
  { id: 'hard', label: 'Hard' },
  { id: 'good', label: 'Good' },
  { id: 'easy', label: 'Easy' },
];

type Props = {
  cards: Flashcard[];
  queue?: ReviewQueue;
  onClose?: () => void;
};

/**
 * Full quiz session view — mount as a modal or main-area overlay.
 */
export function QuizView({ cards, queue, onClose }: Props) {
  const { current, revealed, finished, progress, start, reveal, answer } = useQuizSession();

  useEffect(() => {
    start(cards);
  }, [cards, start]);

  const onAnswer = (rating: Rating) => {
    const record = answer(rating);
    if (record && queue) {
      queue.rate(record.cardId, rating, record.at);
    }
  };

  if (finished) {
    return (
      <div className="mv-quiz-view">
        <div className="mv-panel-label">QUIZ</div>
        <h3>Session complete</h3>
        <p className="mv-muted">
          Answered {progress.answered} of {progress.total} cards.
        </p>
        {onClose ? (
          <button type="button" className="mv-btn" onClick={onClose}>
            Done
          </button>
        ) : null}
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mv-quiz-view">
        <div className="mv-panel-label">QUIZ</div>
        <p className="mv-muted">No cards in this session.</p>
        {onClose ? (
          <button type="button" className="mv-btn" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mv-quiz-view">
      <div className="mv-panel-label">
        QUIZ · {progress.answered + 1}/{progress.total}
      </div>
      <div className="mv-card-face">
        <strong>{current.front}</strong>
        {revealed ? <p>{current.back}</p> : <p className="mv-muted">Tap reveal to see the answer</p>}
      </div>
      {!revealed ? (
        <button type="button" className="mv-btn" onClick={reveal}>
          Reveal
        </button>
      ) : (
        <div className="mv-rating-row">
          {RATINGS.map((r) => (
            <button key={r.id} type="button" className="mv-btn mv-btn-sm" onClick={() => onAnswer(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {onClose ? (
        <button type="button" className="mv-link" onClick={onClose}>
          End quiz
        </button>
      ) : null}
    </div>
  );
}
