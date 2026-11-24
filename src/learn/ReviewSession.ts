import type { ReviewStateStore } from './ReviewStateStore';
import { State, type Scheduler } from './scheduler';
import { studyDayEnd } from './studyDay';
import type { Rating, ReviewCard, ReviewSettings } from './types';

/** Learning cards may be shown this early when nothing else is left (Anki's default). */
const LEARN_AHEAD_MS = 20 * 60_000;

export type QueueCounts = { newCount: number; learning: number; review: number };

type Buckets = { fresh: ReviewCard[]; learning: ReviewCard[]; review: ReviewCard[] };

function bucket(cards: ReviewCard[], store: ReviewStateStore, now: number): Buckets {
  const dayEnd = studyDayEnd(now);
  const out: Buckets = { fresh: [], learning: [], review: [] };
  const enrolled: ReviewCard[] = [];
  for (const card of cards) {
    if (!store.isActive(card)) continue;
    const entry = store.get(card.id);
    const sched = entry?.sched;
    if (!sched || sched.state === State.New) {
      (entry?.enrolled ? enrolled : out.fresh).push(card);
    } else if (sched.state === State.Learning || sched.state === State.Relearning) {
      if (sched.due <= dayEnd) out.learning.push(card);
    } else if (sched.due <= dayEnd) {
      out.review.push(card);
    }
  }
  // Missed quiz questions go ahead of other new cards.
  out.fresh = [...enrolled, ...out.fresh];
  const due = (card: ReviewCard) => store.get(card.id)?.sched?.due ?? 0;
  out.review.sort((a, b) => due(a) - due(b));
  out.learning.sort((a, b) => due(a) - due(b));
  return out;
}

function limits(store: ReviewStateStore, settings: ReviewSettings, now: number) {
  const today = store.today(now);
  return {
    newLeft: Math.max(0, settings.newPerDay - today.newSeen),
    reviewLeft: Math.max(0, settings.maxReviewsPerDay - (today.reviews - today.newSeen)),
  };
}

function cappedCounts(available: QueueCounts, store: ReviewStateStore, settings: ReviewSettings, now: number): QueueCounts {
  const { newLeft, reviewLeft } = limits(store, settings, now);
  const learning = Math.min(reviewLeft, available.learning);
  return {
    newCount: Math.min(newLeft, available.newCount),
    learning,
    review: Math.min(reviewLeft - learning, available.review),
  };
}

/** What a deck has waiting today, after daily limits. */
export function queueCounts(cards: ReviewCard[], store: ReviewStateStore, settings: ReviewSettings, now: number): QueueCounts {
  const buckets = bucket(cards, store, now);
  return cappedCounts({
    newCount: buckets.fresh.length,
    learning: buckets.learning.length,
    review: buckets.review.length,
  }, store, settings, now);
}

/** Spread `extra` evenly through `base` so new cards don't all come at the end. */
function interleave<T>(base: T[], extra: T[]): T[] {
  if (extra.length === 0) return [...base];
  if (base.length === 0) return [...extra];
  const out: T[] = [];
  const step = (base.length + extra.length) / extra.length;
  let next = step / 2;
  let b = 0;
  let e = 0;
  for (let i = 0; i < base.length + extra.length; i += 1) {
    if (e < extra.length && (i >= next || b >= base.length)) {
      out.push(extra[e]);
      e += 1;
      next += step;
    } else {
      out.push(base[b]);
      b += 1;
    }
  }
  return out;
}

/**
 * One sitting of review. Cards you miss (or that are still in learning steps)
 * come back later in the same session once their short interval has passed.
 */
export class ReviewSession {
  private cards = new Map<string, ReviewCard>();
  private main: string[];
  private learning: string[];
  private history: string[] = [];
  private lastReviewTime: number;
  reviewed = 0;

  constructor(
    cards: ReviewCard[],
    private store: ReviewStateStore,
    private scheduler: Scheduler,
    private settings: ReviewSettings,
    now: number,
  ) {
    for (const card of cards) this.cards.set(card.id, card);
    const buckets = bucket(cards, store, now);
    this.lastReviewTime = now;
    const counts = cappedCounts({
      newCount: buckets.fresh.length,
      learning: buckets.learning.length,
      review: buckets.review.length,
    }, store, settings, now);
    const reviewIds = buckets.review.map((card) => card.id);
    const newIds = buckets.fresh.map((card) => card.id);
    this.main = [
      ...interleave(reviewIds.slice(0, counts.review), newIds.slice(0, counts.newCount)),
      ...reviewIds.slice(counts.review),
      ...newIds.slice(counts.newCount),
    ];
    this.learning = buckets.learning.map((card) => card.id);
  }

  private due(id: string): number {
    return this.store.get(id)?.sched?.due ?? 0;
  }

  private sortLearning(): void {
    this.learning.sort((a, b) => this.due(a) - this.due(b));
  }

  /** The card to show now, or null when finished (or only waiting on learning steps). */
  current(now: number): ReviewCard | null {
    const counts = this.counts(now);
    const learningHead = counts.learning ? this.learning[0] : undefined;
    if (learningHead && this.due(learningHead) <= now) return this.cards.get(learningHead) ?? null;
    const next = this.main.find((id) => this.isNew(id) ? counts.newCount > 0 : counts.review > 0);
    if (next) return this.cards.get(next) ?? null;
    if (learningHead && this.due(learningHead) <= now + LEARN_AHEAD_MS) return this.cards.get(learningHead) ?? null;
    return null;
  }

  /** When the next waiting learning card becomes due (null when nothing is waiting). */
  nextLearningDue(now = this.lastReviewTime): number | null {
    return this.counts(now).learning ? this.due(this.learning[0]) : null;
  }

  private isNew(id: string): boolean {
    const sched = this.store.get(id)?.sched;
    return !sched || sched.state === State.New;
  }

  counts(now = this.lastReviewTime): QueueCounts {
    const newCount = this.main.filter((id) => this.isNew(id)).length;
    return cappedCounts({
      newCount,
      learning: this.learning.length,
      review: this.main.length - newCount,
    }, this.store, this.settings, now);
  }

  /** The kind of queue a card is in, for colouring the counts. */
  queueOf(id: string): 'new' | 'learning' | 'review' {
    if (this.learning.includes(id)) return 'learning';
    return this.isNew(id) ? 'new' : 'review';
  }

  rate(card: ReviewCard, rating: Rating, now: number): void {
    this.lastReviewTime = now;
    this.main = this.main.filter((id) => id !== card.id);
    this.learning = this.learning.filter((id) => id !== card.id);
    const entry = this.store.review(card, rating, now, this.scheduler);
    const sched = entry.sched!;
    if ((sched.state === State.Learning || sched.state === State.Relearning) && sched.due <= studyDayEnd(now)) {
      this.learning.push(card.id);
      this.sortLearning();
    }
    this.history.push(card.id);
    this.reviewed += 1;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const id = this.history.pop();
    if (!id) return;
    this.store.undo();
    this.learning = this.learning.filter((other) => other !== id);
    this.main = this.main.filter((other) => other !== id);
    const state = this.store.get(id)?.sched?.state;
    if (state === State.Learning || state === State.Relearning) {
      this.learning.push(id);
      this.sortLearning();
    } else {
      this.main.unshift(id);
    }
    this.reviewed = Math.max(0, this.reviewed - 1);
  }

  /** A card edited mid-session got new ids: keep its place in the queue under them. */
  rekey(migrations: Array<{ from: string; to: string }>, cards: ReviewCard[]): void {
    const renamed = new Map(migrations.map(({ from, to }) => [from, to]));
    const rename = (id: string) => renamed.get(id) ?? id;
    const byId = new Map(cards.map((card) => [card.id, card]));
    for (const [from, to] of renamed) {
      if (!this.cards.has(from)) continue;
      this.cards.delete(from);
      const card = byId.get(to);
      if (card) this.cards.set(to, card);
    }
    this.main = this.main.map(rename);
    this.learning = this.learning.map(rename);
    this.history = this.history.map(rename);
  }

  /** Swap in fresh card content (a card edited mid-session) without changing the queue. */
  refresh(cards: ReviewCard[]): void {
    for (const card of cards) if (this.cards.has(card.id)) this.cards.set(card.id, card);
  }

  /** Remove a deleted card from the active session. */
  remove(id: string): void {
    this.cards.delete(id);
    this.main = this.main.filter((other) => other !== id);
    this.learning = this.learning.filter((other) => other !== id);
    this.history = this.history.filter((other) => other !== id);
  }
}
