/**
 * Share payloads: frozen, JSON-only snapshots stored in `shares/{id}.payload`.
 *
 * Every payload carries `schemaVersion` so the viewer can refuse (or migrate)
 * snapshots written by a newer app. Payloads never contain review state
 * (FSRS scheduling, `.vault/srs*`) or quiz attempts/scores: only content.
 *
 * This module is type-only for the app shell (`App.tsx` imports `ShareTarget`
 * with `import type`), so nothing here reaches the desktop bundle.
 */

import type { Deck } from '../../learn/decks';
import type { LinkedCard } from '../../learn/LinkedCards';
import type { ReviewCard } from '../../learn/types';
import type { QuizQuestion } from '../../quiz/types';

export const SHARE_SCHEMA_VERSION = 1 as const;

/** A markdown note inside a payload; `path` is relative to the shared root. */
export type SharedNote = { path: string; markdown: string };

export type NotePayload = {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  /** File name of the note, e.g. `Bayes.md` (no sharer folders). */
  path: string;
  markdown: string;
};

export type FolderPayload = {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  /** Name of the shared folder (last segment). */
  folder: string;
  /** Notes with paths relative to the shared folder. */
  notes: SharedNote[];
};

export type SharedCardContent =
  | { kind: 'basic'; front: string; back: string; reverse?: boolean }
  | { kind: 'cloze'; text: string }
  | { kind: 'mcq'; prompt: string; options: Array<{ text: string; correct: boolean }> };

/**
 * A card's content only. `origin` says how it is recreated on duplicate:
 * `note` cards are written inline in one of `notes` (they come along with the
 * note), `linked` and `quiz` cards are recreated as app cards.
 */
export type SharedCard = SharedCardContent & {
  origin: 'note' | 'linked' | 'quiz';
  /** Path (relative to the deck root) of the note the card belongs to, when shared. */
  sourcePath?: string;
};

export type DeckPayload = {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  label: string;
  cards: SharedCard[];
  /** Source notes that hold the deck's inline (`origin: 'note'`) cards. */
  notes: SharedNote[];
};

export type SharedQuiz = {
  title: string;
  rubric: string;
  questions: QuizQuestion[];
};

export type QuizPayload = {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  /** File name of the quiz note, e.g. `Quiz Bayes.md`. */
  path: string;
  quiz: SharedQuiz;
};

export type SharePayloadByKind = {
  note: NotePayload;
  folder: FolderPayload;
  deck: DeckPayload;
  quiz: QuizPayload;
};

/** What the app asks to share. Deck targets carry the live cards from the review system. */
export type ShareTarget =
  | { kind: 'note'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'quiz'; path: string }
  | { kind: 'deck'; deck: Deck; cards: ReviewCard[]; linkedCards: LinkedCard[] };

export type RequestShare = (target: ShareTarget) => void;
