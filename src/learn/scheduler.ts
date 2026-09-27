import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  State,
  type Card,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import type { Rating, SchedState } from './types';

export { State };

const GRADE: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

export function toSched(card: Card): SchedState {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.getTime() } : {}),
  };
}

export function fromSched(sched: SchedState): Card {
  return {
    ...sched,
    due: new Date(sched.due),
    state: sched.state as State,
    last_review: sched.last_review ? new Date(sched.last_review) : undefined,
  };
}

export function newSched(now: number): SchedState {
  return toSched(createEmptyCard(new Date(now)));
}

/**
 * FSRS (the algorithm Anki uses by default since 23.10) via ts-fsrs.
 * Learning steps behave like Anki: a new card you miss comes back in 1m, then 10m.
 */
export class Scheduler {
  private engine: FSRS;

  constructor(retention = 0.9) {
    this.engine = fsrs(
      generatorParameters({
        request_retention: retention,
        maximum_interval: 36500,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: ['1m', '10m'],
        relearning_steps: ['10m'],
      }),
    );
  }

  next(sched: SchedState | undefined, rating: Rating, now: number): SchedState {
    const card = sched ? fromSched(sched) : createEmptyCard(new Date(now));
    return toSched(this.engine.next(card, new Date(now), GRADE[rating]).card);
  }

  /** When each rating would schedule the card next. */
  preview(sched: SchedState | undefined, now: number): Record<Rating, number> {
    const card = sched ? fromSched(sched) : createEmptyCard(new Date(now));
    const log = this.engine.repeat(card, new Date(now));
    return {
      again: log[FsrsRating.Again].card.due.getTime(),
      hard: log[FsrsRating.Hard].card.due.getTime(),
      good: log[FsrsRating.Good].card.due.getTime(),
      easy: log[FsrsRating.Easy].card.due.getTime(),
    };
  }

  retrievability(sched: SchedState, now: number): number {
    return this.engine.get_retrievability(fromSched(sched), new Date(now), false);
  }
}

/** Short Anki-style interval label: 1m · 10m · 3h · 4d · 2.1mo · 1.3y. */
export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
