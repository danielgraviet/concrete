import type { Flashcard, Rating, SrsState } from '../types';
import type { SchedulerStrategy } from './SchedulerStrategy';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

/** Map UI ratings to classic SM-2 quality (0–5). */
function qualityFor(rating: Rating): number {
  switch (rating) {
    case 'again':
      return 1;
    case 'hard':
      return 3;
    case 'good':
      return 4;
    case 'easy':
      return 5;
  }
}

/**
 * Simplified SM-2 scheduler.
 * Tracks ease, interval (days), repetitions, and dueAt (epoch ms).
 */
export class Sm2SchedulerStrategy implements SchedulerStrategy {
  schedule(card: Flashcard, rating: Rating, now: number = Date.now()): SrsState {
    const q = qualityFor(rating);
    let { ease, interval, repetitions } = card.scheduling;

    if (q < 3) {
      repetitions = 0;
      interval = 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
    } else {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = rating === 'hard' ? 3 : 6;
      } else {
        const factor = rating === 'hard' ? 1.2 : rating === 'easy' ? ease * 1.3 : ease;
        interval = Math.max(1, Math.round(interval * factor));
      }
      repetitions += 1;
      ease = Math.max(
        MIN_EASE,
        ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
      );
    }

    return {
      ease: Math.round(ease * 100) / 100,
      interval,
      repetitions,
      dueAt: now + interval * DAY_MS,
    };
  }
}
