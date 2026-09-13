import type { Flashcard, Rating, SrsState } from '../types';

/** Strategy: how a rating updates SRS state. */
export interface SchedulerStrategy {
  schedule(card: Flashcard, rating: Rating, now?: number): SrsState;
}
