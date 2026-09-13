import { useCallback, useReducer, useRef } from 'react';
import { QuizSession } from './QuizSession';
import type { QuizAnswerRecord, QuizProgress } from './QuizSession';
import type { Flashcard, Rating } from './types';

type Snapshot = {
  current: Flashcard | null;
  revealed: boolean;
  finished: boolean;
  progress: QuizProgress;
  answers: QuizAnswerRecord[];
};

function snapshot(session: QuizSession): Snapshot {
  return {
    current: session.current,
    revealed: session.isRevealed,
    finished: session.finished,
    progress: session.progress,
    answers: session.answerHistory,
  };
}

const emptyProgress: QuizProgress = { index: 0, total: 0, answered: 0, remaining: 0 };

const initial: Snapshot = {
  current: null,
  revealed: false,
  finished: true,
  progress: emptyProgress,
  answers: [],
};

/**
 * React hook wrapping QuizSession pure logic.
 */
export function useQuizSession() {
  const sessionRef = useRef(new QuizSession());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const sync = useCallback(() => {
    bump();
  }, []);

  const start = useCallback(
    (cards: Flashcard[]) => {
      sessionRef.current.start(cards);
      sync();
    },
    [sync],
  );

  const reveal = useCallback(() => {
    sessionRef.current.reveal();
    sync();
  }, [sync]);

  const answer = useCallback(
    (rating: Rating) => {
      const record = sessionRef.current.answer(rating);
      sync();
      return record;
    },
    [sync],
  );

  const state = snapshot(sessionRef.current);

  return {
    ...state,
    start,
    reveal,
    answer,
    session: sessionRef.current,
  };
}
