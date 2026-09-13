import type { Flashcard, Rating } from './types';

export type QuizProgress = {
  index: number;
  total: number;
  answered: number;
  remaining: number;
};

export type QuizAnswerRecord = {
  cardId: string;
  rating: Rating;
  at: number;
};

/**
 * Pure quiz session state machine — no React dependency.
 */
export class QuizSession {
  private cards: Flashcard[] = [];
  private index = 0;
  private revealed = false;
  private answers: QuizAnswerRecord[] = [];
  private done = false;

  start(cards: Flashcard[]): void {
    this.cards = [...cards];
    this.index = 0;
    this.revealed = false;
    this.answers = [];
    this.done = this.cards.length === 0;
  }

  get current(): Flashcard | null {
    if (this.done || this.index >= this.cards.length) return null;
    return this.cards[this.index] ?? null;
  }

  get isRevealed(): boolean {
    return this.revealed;
  }

  get finished(): boolean {
    return this.done;
  }

  get progress(): QuizProgress {
    const total = this.cards.length;
    const answered = this.answers.length;
    return {
      index: Math.min(this.index, Math.max(total - 1, 0)),
      total,
      answered,
      remaining: Math.max(total - answered, 0),
    };
  }

  get answerHistory(): QuizAnswerRecord[] {
    return [...this.answers];
  }

  reveal(): void {
    if (!this.done && this.current) {
      this.revealed = true;
    }
  }

  answer(rating: Rating, now: number = Date.now()): QuizAnswerRecord | null {
    const card = this.current;
    if (!card || this.done) return null;
    if (!this.revealed) this.revealed = true;

    const record: QuizAnswerRecord = { cardId: card.id, rating, at: now };
    this.answers.push(record);
    this.revealed = false;
    this.index += 1;
    if (this.index >= this.cards.length) {
      this.done = true;
    }
    return record;
  }
}
