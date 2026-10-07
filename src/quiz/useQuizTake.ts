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
import { clearQuizDraft, loadQuizDraft, saveQuizDraft } from './draft';
import { QuizHistoryStore } from './history';
import { quizGradingJobs } from './gradingJobs';

export type QuizTakePhase = 'taking' | 'grading' | 'graded';

type State = {
  path: string;
  vaultRoot: string;
  sessionSeed: string;
  startedAt: number;
  responses: Record<string, QuizResponse>;
  error: string | null;
};

function newSessionSeed(path: string): string {
  return `${path}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function freshState(path: string, vaultRoot: string): State {
  return {
    path,
    vaultRoot,
    sessionSeed: newSessionSeed(path),
    startedAt: Date.now(),
    responses: {},
    error: null,
  };
}

/** Resume a grading job, or an unfinished attempt saved before the quiz was closed. */
function initialState(path: string, vaultRoot: string): State {
  const job = quizGradingJobs.get(path);
  if (job) {
    return { path, vaultRoot, sessionSeed: job.sessionSeed, startedAt: job.startedAt, responses: job.responses, error: null };
  }
  const draft = loadQuizDraft(vaultRoot, path);
  if (draft) {
    return {
      path,
      vaultRoot,
      sessionSeed: draft.sessionSeed,
      startedAt: draft.startedAt,
      responses: draft.responses,
      error: null,
    };
  }
  return freshState(path, vaultRoot);
}

export function useQuizTake(markdown: string, documentPath: string, client: AiClient, historyStore?: QuizHistoryStore) {
  const quiz: QuizDocument = useMemo(() => parseQuizMarkdown(markdown), [markdown]);

  const defaultHistory = useMemo(() => new QuizHistoryStore(), []);
  const history = historyStore ?? defaultHistory;
  const vaultRoot = history.vaultRoot;

  const [stored, setState] = useState<State>(() => initialState(documentPath, historyStore?.vaultRoot ?? '__default__'));
  // Switched quiz or vault: adopt that attempt during render, before painting the old one.
  const state = stored.path === documentPath && stored.vaultRoot === vaultRoot
    ? stored
    : initialState(documentPath, vaultRoot);
  if (state !== stored) setState(state);

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

  // Keep the unfinished attempt until submit. Leaving the quiz, or the app, restores it.
  useEffect(() => {
    if (phase !== 'taking' || state.path !== documentPath) return;
    const ids = new Set(quiz.questions.map((question) => question.id));
    const responses = Object.fromEntries(
      Object.entries(state.responses).filter(([id]) => ids.has(id)),
    );
    saveQuizDraft(vaultRoot, {
      path: documentPath,
      sessionSeed: state.sessionSeed,
      startedAt: state.startedAt,
      responses,
    });
  }, [documentPath, phase, quiz.questions, state.path, state.responses, state.sessionSeed, state.startedAt, vaultRoot]);

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
    clearQuizDraft(vaultRoot, documentPath);
    setState((prev) => ({ ...prev, error: null }));
    const ids = new Set(quiz.questions.map((question) => question.id));
    const responses = Object.fromEntries(
      Object.entries(state.responses).filter(([id]) => ids.has(id)),
    );
    quizGradingJobs.start({
      path: documentPath,
      quiz,
      responses,
      sessionSeed: state.sessionSeed,
      startedAt: state.startedAt,
      client,
      history,
    });
  }, [client, documentPath, history, quiz, state.responses, state.sessionSeed, state.startedAt, vaultRoot]);

  const retake = useCallback(() => {
    quizGradingJobs.clear(documentPath);
    clearQuizDraft(vaultRoot, documentPath);
    setState(freshState(documentPath, vaultRoot));
  }, [documentPath, vaultRoot]);

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
