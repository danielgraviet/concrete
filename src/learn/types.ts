/** Spaced-repetition domain types. Card content lives in markdown; review state in `.vault/srs.json`. */

import type { McqQuestion } from '../quiz/types';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

/** Where a card was written: vault-relative note path and 0-based line. */
export type CardSource = {
  path: string;
  line: number;
  /** 'note' = written with card syntax; 'quiz' = a question in a `Quiz *.md` file. */
  origin: 'note' | 'quiz';
};

export type BasicCard = {
  kind: 'basic';
  id: string;
  front: string;
  back: string;
  source: CardSource;
};

export type ClozeCard = {
  kind: 'cloze';
  id: string;
  /** Block text with `{{…}}` markup (list markers stripped). */
  text: string;
  /** Which blanks this card hides; blanks sharing a group are hidden together. */
  group: string;
  source: CardSource;
};

export type McqCard = {
  kind: 'mcq';
  id: string;
  question: McqQuestion;
  source: CardSource;
};

export type ReviewCard = BasicCard | ClozeCard | McqCard;

/** A card before its id is assigned. */
export type CardDraft = ReviewCard extends infer C ? (C extends ReviewCard ? Omit<C, 'id'> : never) : never;

/** FSRS state, serialized with epoch-ms dates. */
export type SchedState = {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** 0 new · 1 learning · 2 review · 3 relearning (ts-fsrs `State`). */
  state: number;
  last_review?: number;
};

export type StoredCard = {
  /** Missing until the card is first reviewed (or enrolled from a quiz). */
  sched?: SchedState;
  /** Last known location + text, used to re-attach history after edits/renames. */
  path: string;
  kind: ReviewCard['kind'];
  fp: string;
  /** Quiz questions only enter review when enrolled (missed) or their quiz is enabled. */
  enrolled?: boolean;
  /** Set when the card vanished from the vault; pruned after a grace period. */
  orphanedAt?: number;
};

export type DayStats = { newSeen: number; reviews: number; again: number };

export type SrsFile = {
  version: 1;
  cards: Record<string, StoredCard>;
  /** Keyed by study day (`YYYY-MM-DD`, rolling over at 4am). */
  days: Record<string, DayStats>;
  /** Quiz paths whose every question is in review. */
  quizzes: Record<string, { enabled: boolean }>;
  /** Quiz attempts completed before this are already folded into review. */
  quizSyncAt: number;
};

export type { ReviewSettings } from '../settings/types';
