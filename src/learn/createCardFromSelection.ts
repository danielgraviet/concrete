import type { CreateCardInput, Flashcard } from './types';
import { DEFAULT_SRS } from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Pure factory for a new flashcard (does not persist).
 * Prefer CardStore.createCardFromSelection when you have a store.
 */
export function createCardFromSelection(
  input: CreateCardInput,
  now: number = Date.now(),
): Flashcard {
  return {
    id: newId(),
    notePath: input.notePath,
    front: input.front.trim(),
    back: input.back.trim(),
    tags: input.tags ?? [],
    createdAt: now,
    scheduling: { ...DEFAULT_SRS, dueAt: now },
  };
}
