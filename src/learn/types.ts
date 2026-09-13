/** Flashcard + spaced-repetition domain types. */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export type SrsState = {
  ease: number;
  interval: number;
  repetitions: number;
  dueAt: number;
};

export type Flashcard = {
  id: string;
  notePath: string;
  front: string;
  back: string;
  tags: string[];
  createdAt: number;
  scheduling: SrsState;
};

export type CreateCardInput = {
  notePath: string;
  front: string;
  back: string;
  tags?: string[];
};

export type CardsFile = {
  version: 1;
  cards: Flashcard[];
};

export const DEFAULT_SRS: SrsState = {
  ease: 2.5,
  interval: 0,
  repetitions: 0,
  dueAt: 0,
};
