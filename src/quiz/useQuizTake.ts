import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiClient } from '../ai/AiClient';
import { presentQuiz } from './present';
import { parseQuizMarkdown } from './parseQuizMarkdown';
import type {
  GradeReport,
  PresentedQuestion,
  QuizDocument,
  QuizResponse,
} from './types';
import { buildQuizAttempt, QuizHistoryStore } from './history';
import { finalizeWithoutProbes, mergeProbeResults, probesFromReport, type Probe } from './probe';

export type QuizTakePhase = 'taking' | 'grading' | 'probing' | 'graded';

type State = {
  sessionSeed: string;
  responses: Record<string, QuizResponse>;
  phase: QuizTakePhase;
  report: GradeReport | null;
  /** First-pass report held while the student answers follow-up probes. */
  pendingReport: GradeReport | null;
  probes: Probe[];
  error: string | null;
};

function newSessionSeed(path: string): string {
  return `${path}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function freshState(path: string): State {
  return {
    sessionSeed: newSessionSeed(path),
    responses: {},
    phase: 'taking',
    report: null,
    pendingReport: null,
    probes: [],
    error: null,
  };
}

export function useQuizTake(markdown: string, documentPath: string, client: AiClient, historyStore?: QuizHistoryStore) {
  const quiz: QuizDocument = useMemo(() => parseQuizMarkdown(markdown), [markdown]);

  const [state, setState] = useState<State>(() => freshState(documentPath));
  const defaultHistory = useMemo(() => new QuizHistoryStore(), []);
  const history = historyStore ?? defaultHistory;
  const startedAt = useRef(Date.now());
  const savedSession = useRef<string | null>(null);

  useEffect(() => {
    setState(freshState(documentPath));
    startedAt.current = Date.now();
    savedSession.current = null;
  }, [documentPath]);

  const presented: PresentedQuestion[] = useMemo(
    () => presentQuiz(quiz, state.sessionSeed),
    [quiz, state.sessionSeed],
  );

  const setResponse = useCallback((response: QuizResponse) => {
    setState((prev) => ({
      ...prev,
      responses: { ...prev.responses, [response.questionId]: response },
      phase: prev.phase === 'graded' ? 'taking' : prev.phase,
      report: prev.phase === 'graded' ? null : prev.report,
    }));
  }, []);

  const reshuffle = useCallback(() => {
    setState((prev) => ({
      ...prev,
      sessionSeed: newSessionSeed(documentPath),
      phase: 'taking',
      report: null,
      pendingReport: null,
      probes: [],
      error: null,
    }));
  }, [documentPath]);

  /** Add the reference answer to any question that was not fully correct. */
  const enrich = useCallback(
    (report: GradeReport): GradeReport => ({
      ...report,
      perQuestion: report.perQuestion.map((item) => {
        const question = quiz.questions.find((q) => q.id === item.questionId);
        if (!question || item.score >= item.maxScore) return item;
        const correctAnswer = question.type === 'mcq'
          ? question.options.filter((option) => option.correct).map((option) => option.text).join(', ')
          : question.type === 'cloze'
            ? question.answers.join(', ')
            : question.type === 'code'
              ? question.expected
              : question.answer;
        return { ...item, correctAnswer };
      }),
    }),
    [quiz],
  );

  const finish = useCallback(
    (report: GradeReport) => {
      const finalReport = enrich(report);
      setState((prev) => ({ ...prev, phase: 'graded', report: finalReport, pendingReport: null, probes: [] }));
      if (savedSession.current !== state.sessionSeed) {
        history.add(buildQuizAttempt(quiz, finalReport, documentPath, startedAt.current, Date.now(), state.sessionSeed));
        savedSession.current = state.sessionSeed;
      }
    },
    [documentPath, enrich, history, quiz, state.sessionSeed],
  );

  const submit = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: 'grading', error: null }));
    try {
      const report = await client.gradeQuiz({
        quiz,
        responses: Object.values(state.responses),
        rubric: quiz.rubric,
        allowProbes: true,
      });
      const probes = probesFromReport(report);
      if (probes.length > 0) {
        // Vague answers: ask a "why?" follow-up before finalizing the grade.
        setState((prev) => ({ ...prev, phase: 'probing', pendingReport: report, probes }));
      } else {
        finish(report);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Grading failed';
      setState((prev) => ({ ...prev, phase: 'taking', error: message }));
    }
  }, [client, finish, quiz, state.responses]);

  const answerProbes = useCallback(
    async (answers: Record<string, string>) => {
      const first = state.pendingReport;
      if (!first) return;
      const followUps = state.probes
        .filter((probe) => (answers[probe.questionId] ?? '').trim())
        .map((probe) => ({
          questionId: probe.questionId,
          question: probe.followUp,
          answer: answers[probe.questionId].trim(),
        }));
      if (followUps.length === 0) {
        finish(finalizeWithoutProbes(first));
        return;
      }
      setState((prev) => ({ ...prev, phase: 'grading', error: null }));
      try {
        const second = await client.gradeQuiz({
          quiz,
          responses: Object.values(state.responses),
          rubric: quiz.rubric,
          followUps,
        });
        finish(mergeProbeResults(first, second, new Set(followUps.map((f) => f.questionId))));
      } catch {
        // Re-grading failed: keep the first-round grades rather than losing the attempt.
        finish(finalizeWithoutProbes(first));
      }
    },
    [client, finish, quiz, state.pendingReport, state.probes, state.responses],
  );

  const skipProbes = useCallback(() => {
    if (state.pendingReport) finish(finalizeWithoutProbes(state.pendingReport));
  }, [finish, state.pendingReport]);

  const retake = useCallback(() => {
    setState(freshState(documentPath));
  }, [documentPath]);

  return {
    quiz,
    presented,
    responses: state.responses,
    phase: state.phase,
    report: state.report,
    probes: state.probes,
    error: state.error,
    setResponse,
    reshuffle,
    submit,
    answerProbes,
    skipProbes,
    retake,
  };
}
