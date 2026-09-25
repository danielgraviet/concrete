import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AiClient } from '../ai/AiClient';
import { presentQuiz } from './present';
import { parseQuizMarkdown } from './parseQuizMarkdown';
import type {
  GradeReport,
  PresentedQuestion,
  QuizDocument,
  QuizResponse,
} from './types';
import { QuizHistoryStore } from './history';
import { quizGradingJobs } from './gradingJobs';

export type QuizTakePhase = 'taking' | 'grading' | 'graded';

type State = {
  path: string;
  sessionSeed: string;
  startedAt: number;
  responses: Record<string, QuizResponse>;
  error: string | null;
};

function newSessionSeed(path: string): string {
  return `${path}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function freshState(path: string): State {
  return {
    path,
    sessionSeed: newSessionSeed(path),
    startedAt: Date.now(),
    responses: {},
    error: null,
  };
}

/** Resume a grading job that was started (or finished) while this quiz was closed. */
function initialState(path: string): State {
  const job = quizGradingJobs.get(path);
  if (!job) return freshState(path);
  return { path, sessionSeed: job.sessionSeed, startedAt: job.startedAt, responses: job.responses, error: null };
}

export function useQuizTake(markdown: string, documentPath: string, client: AiClient, historyStore?: QuizHistoryStore) {
  const quiz: QuizDocument = useMemo(() => parseQuizMarkdown(markdown), [markdown]);

  const [stored, setState] = useState<State>(() => initialState(documentPath));
  // Switched to another quiz: adopt its state during render, before painting the old one.
  const state = stored.path === documentPath ? stored : initialState(documentPath);
  if (state !== stored) setState(state);

  const defaultHistory = useMemo(() => new QuizHistoryStore(), []);
  const history = historyStore ?? defaultHistory;

  const job = useSyncExternalStore(quizGradingJobs.subscribe, () => quizGradingJobs.get(documentPath));
  const activeJob = job?.sessionSeed === state.sessionSeed ? job : undefined;

  // The student is looking at this quiz, so its result is no longer "unseen".
  useEffect(() => {
    if (!activeJob?.unseen) return;
    if (activeJob.status === 'error') {
      setState((prev) => ({ ...prev, error: activeJob.error ?? 'Grading failed' }));
      quizGradingJobs.clear(documentPath);
    } else {
      quizGradingJobs.markSeen(documentPath);
    }
  }, [activeJob, documentPath]);

  const phase: QuizTakePhase =
    activeJob?.status === 'grading' ? 'grading' : activeJob?.status === 'graded' ? 'graded' : 'taking';
  const report: GradeReport | null = activeJob?.status === 'graded' ? activeJob.report ?? null : null;

  const presented: PresentedQuestion[] = useMemo(
    () => presentQuiz(quiz, state.sessionSeed),
    [quiz, state.sessionSeed],
  );

  const setResponse = useCallback((response: QuizResponse) => {
    setState((prev) => ({ ...prev, responses: { ...prev.responses, [response.questionId]: response } }));
  }, []);

  const reshuffle = useCallback(() => {
    quizGradingJobs.clear(documentPath);
    setState((prev) => ({ ...prev, sessionSeed: newSessionSeed(documentPath), error: null }));
  }, [documentPath]);

  const submit = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
    quizGradingJobs.start({
      path: documentPath,
      quiz,
      responses: state.responses,
      sessionSeed: state.sessionSeed,
      startedAt: state.startedAt,
      client,
      history,
    });
  }, [client, documentPath, history, quiz, state.responses, state.sessionSeed, state.startedAt]);

  const retake = useCallback(() => {
    quizGradingJobs.clear(documentPath);
    setState(freshState(documentPath));
  }, [documentPath]);

  return {
    quiz,
    presented,
    responses: state.responses,
    phase,
    report,
    error: state.error,
    sessionSeed: state.sessionSeed,
    /** Set once submitted: this attempt's place among all quizzes taken. */
    quizNumber: activeJob?.quizNumber ?? null,
    history,
    setResponse,
    reshuffle,
    submit,
    retake,
  };
}
