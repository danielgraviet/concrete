import { describe, expect, it } from 'vitest';
import { cardsFromNote } from './buildCards';
import { planMigrations } from './reconcile';
import { ReviewSession } from './ReviewSession';
import { ReviewStateStore } from './ReviewStateStore';
import { Scheduler, State } from './scheduler';
import type { ReviewSettings } from './types';

const settings: ReviewSettings = { retention: 0.9, newPerDay: 20, maxReviewsPerDay: 200, typeCloze: false };
const MIN = 60_000;
const DAY = 86_400_000;
// Midday, so the 4am rollover never lands inside a test.
const T0 = new Date(2026, 0, 5, 12).getTime();

function freshStore(): ReviewStateStore {
  return new ReviewStateStore('');
}

describe('Scheduler (FSRS)', () => {
  it('uses 1m/10m learning steps for a new card, then graduates', () => {
    const s = new Scheduler(0.9);
    const again = s.next(undefined, 'again', T0);
    expect(again.state).toBe(State.Learning);
    expect(again.due - T0).toBe(1 * MIN);
    const good = s.next(undefined, 'good', T0);
    expect(good.due - T0).toBe(10 * MIN);
    const graduated = s.next(good, 'good', good.due);
    expect(graduated.state).toBe(State.Review);
    expect(graduated.due - good.due).toBeGreaterThanOrEqual(DAY);
  });

  it('previews increasing intervals for again < hard < good < easy', () => {
    const s = new Scheduler(0.9);
    const p = s.preview(undefined, T0);
    expect(p.again).toBeLessThan(p.hard);
    expect(p.hard).toBeLessThanOrEqual(p.good);
    expect(p.good).toBeLessThan(p.easy);
  });
});

describe('ReviewSession', () => {
  it('re-shows a missed new card once its learning step is due', () => {
    const store = freshStore();
    const cards = cardsFromNote('n.md', 'A :: 1\nB :: 2');
    const session = new ReviewSession(cards, store, new Scheduler(), settings, T0);
    expect(session.counts()).toEqual({ newCount: 2, learning: 0, review: 0 });

    const first = session.current(T0)!;
    session.rate(first, 'again', T0);
    const second = session.current(T0)!;
    expect(second.id).not.toBe(first.id);
    session.rate(second, 'easy', T0);

    // Only the missed card is left; it may be learned ahead within 20 minutes.
    expect(session.current(T0 + 30_000)?.id).toBe(first.id);
    session.rate(first, 'good', T0 + MIN);
    session.rate(first, 'good', T0 + 11 * MIN);
    expect(session.current(T0 + 12 * MIN)).toBeNull();
    expect(store.today(T0)).toMatchObject({ newSeen: 2, again: 1 });
  });

  it('respects the daily new-card limit and undo restores state', () => {
    const store = freshStore();
    const cards = cardsFromNote('n.md', 'A :: 1\nB :: 2\nC :: 3');
    const session = new ReviewSession(cards, store, new Scheduler(), { ...settings, newPerDay: 2 }, T0);
    expect(session.counts().newCount).toBe(2);
    const card = session.current(T0)!;
    session.rate(card, 'easy', T0);
    expect(store.get(card.id)?.sched).toBeDefined();
    session.undo();
    expect(store.get(card.id)).toBeUndefined();
    expect(session.current(T0)?.id).toBe(card.id);
  });

  it('keeps quiz questions out of review until enrolled', () => {
    const store = freshStore();
    const [card] = cardsFromNote('n.md', 'Q :: A');
    const quizCard = { ...card, id: 'quiz1', source: { ...card.source, origin: 'quiz' as const } };
    expect(new ReviewSession([quizCard], store, new Scheduler(), settings, T0).counts().newCount).toBe(0);
    store.enroll([quizCard], T0);
    expect(new ReviewSession([quizCard], store, new Scheduler(), settings, T0).counts().newCount).toBe(1);
  });
});

describe('reconcile', () => {
  it('moves history to an edited card in the same note, not to unrelated cards', () => {
    const store = freshStore();
    const [before] = cardsFromNote('n.md', 'What does TCP guarantee? :: Ordered delivery');
    store.review(before, 'good', T0, new Scheduler());
    const after = cardsFromNote('n.md', 'What does TCP guarantee to apps? :: Ordered delivery\nCompletely different :: x');
    expect(planMigrations(after, { [before.id]: store.get(before.id)! })).toEqual([{ from: before.id, to: after[0].id }]);
    store.reconcile(after, T0);
    expect(store.get(after[0].id)?.sched).toBeDefined();
    expect(store.get(before.id)).toBeUndefined();
  });

  it('follows a card into a renamed note only when the text is unchanged', () => {
    const store = freshStore();
    const [before] = cardsFromNote('old.md', 'Some question here :: A');
    store.review(before, 'good', T0, new Scheduler());
    // Same text → same id, so history simply follows; the stored path updates.
    const moved = cardsFromNote('new.md', 'Some question here :: A');
    store.reconcile(moved, T0);
    expect(store.get(moved[0].id)?.path).toBe('new.md');
  });
});
