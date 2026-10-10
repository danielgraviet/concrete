import { useMemo } from 'react';
import { IconButton, Text } from '@radix-ui/themes';
import { Cross1Icon } from '@radix-ui/react-icons';
import { ALL_DECK, deckFilter, deckKey, listDecks, type Deck } from './decks';
import { queueCounts, type QueueCounts } from './ReviewSession';
import { studyDayEnd } from './studyDay';
import type { ReviewSystem } from './useReviewSystem';
import { shortcutWithShift } from '../platform';

function CountPills({ counts }: { counts: QueueCounts }) {
  return (
    <span className="srs-counts srs-counts-sm">
      <span className="srs-count-new" title="New">{counts.newCount}</span>
      <span className="srs-count-learning" title="Learning">{counts.learning}</span>
      <span className="srs-count-review" title="To review">{counts.review}</span>
    </span>
  );
}

type Props = {
  system: ReviewSystem;
  onStart: (deck: Deck) => void;
  onClose: () => void;
};

/** Deck list: all cards, then every folder and tag that has cards. */
export function ReviewSidebar({ system, onStart, onClose }: Props) {
  const { cards, index, store, settings, revision } = system;

  const rows = useMemo(() => {
    const now = Date.now();
    return [ALL_DECK, ...listDecks(cards, index)].map((deck) => {
      const inDeck = cards.filter(deckFilter(deck, index));
      return { deck, total: inDeck.length, counts: queueCounts(inDeck, store, settings, now) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision covers index/store changes
  }, [cards, index, store, settings, revision]);

  const stats = useMemo(() => {
    const now = Date.now();
    const today = store.today(now);
    const forecast = store.forecast(cards, studyDayEnd(now), 8);
    return { today, tomorrow: forecast[1] ?? 0, week: forecast.slice(1).reduce((a, b) => a + b, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision covers store changes
  }, [cards, store, revision]);

  const retention = stats.today.reviews - stats.today.newSeen > 0
    ? Math.round((1 - stats.today.again / Math.max(1, stats.today.reviews)) * 100)
    : null;

  return (
    <>
      <div className="sidebar-heading">
        <Text size="1" color="gray" weight="bold">
          REVIEW
        </Text>
        <IconButton type="button" size="1" variant="ghost" color="gray" aria-label="Collapse sidebar" onClick={onClose}>
          <Cross1Icon />
        </IconButton>
      </div>
      <div className="srs-sidebar">
        {cards.length === 0 ? (
          <div className="srs-empty">
            <strong>No cards yet</strong>
            <p>Write cards in any note, or open Create cards in the right panel:</p>
            <code>Question :: Answer</code>
            <code>Term ::: Definition</code>
            <code>{'The {{answer}} is hidden'}</code>
            <code>?mcq … - [x] option</code>
            <p>
              Or select text and press <kbd>{shortcutWithShift('C')}</kbd> to make a blank, or <kbd>{shortcutWithShift('K')}</kbd> to start a card.
            </p>
          </div>
        ) : (
          <div className="srs-decks">
            {rows.map(({ deck, total, counts }) => {
              const waiting = counts.newCount + counts.learning + counts.review;
              return (
                <button
                  key={deckKey(deck)}
                  type="button"
                  className={`srs-deck ${deck.kind === 'all' ? 'srs-deck-all' : ''} ${waiting ? '' : 'srs-deck-idle'}`}
                  title={`${total} card${total === 1 ? '' : 's'}`}
                  onClick={() => onStart(deck)}
                >
                  <span className="srs-deck-label">{deck.label}</span>
                  <CountPills counts={counts} />
                </button>
              );
            })}
          </div>
        )}
        <div className="srs-stats">
          <div>
            <span>Today</span>
            <strong>{stats.today.reviews}</strong>
            <small>{retention !== null ? `${retention}% recalled` : 'reviews'}</small>
          </div>
          <div>
            <span>Tomorrow</span>
            <strong>{stats.tomorrow}</strong>
            <small>due</small>
          </div>
          <div>
            <span>Next 7 days</span>
            <strong>{stats.week}</strong>
            <small>due</small>
          </div>
        </div>
        <p className="srs-legend">
          <span className="srs-count-new">new</span> · <span className="srs-count-learning">learning</span> ·{' '}
          <span className="srs-count-review">review</span>
        </p>
      </div>
    </>
  );
}
