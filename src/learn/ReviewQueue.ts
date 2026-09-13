import type { CardStore } from './CardStore';
import type { SchedulerStrategy } from './scheduler/SchedulerStrategy';
import type { Flashcard, Rating } from './types';

/**
 * Due-card queue backed by a CardStore + SchedulerStrategy.
 */
export class ReviewQueue {
  constructor(
    private store: CardStore,
    private strategy: SchedulerStrategy,
  ) {}

  dueCards(now: number = Date.now()): Flashcard[] {
    return this.store
      .getAll()
      .filter((card) => card.scheduling.dueAt <= now)
      .sort((a, b) => a.scheduling.dueAt - b.scheduling.dueAt);
  }

  rate(cardId: string, rating: Rating, now: number = Date.now()): Flashcard | undefined {
    const card = this.store.getById(cardId);
    if (!card) return undefined;
    const scheduling = this.strategy.schedule(card, rating, now);
    return this.store.updateScheduling(cardId, scheduling);
  }

  dueCount(now: number = Date.now()): number {
    return this.dueCards(now).length;
  }
}
