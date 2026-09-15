import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiClient } from '../ai/AiClient';
import { presentQuiz } from './present';
import { parseQuizMarkdown } from './parseQuizMarkdown';
import type {
  GradeReport,
  PresentedQuestion,
  QuizDocument,
  QuizResponse,
} from './types';

export type QuizTakePhase = 'taking' | 'grading' | 'graded';

type State = {
  sessionSeed: string;
  responses: Record<string, QuizResponse>;
  phase: QuizTakePhase;
  report: GradeReport | null;
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
    error: null,
  };
}

export function useQuizTake(markdown: string, documentPath: string, client: AiClient) {
  const quiz: QuizDocument = useMemo(() => parseQuizMarkdown(markdown), [markdown]);

  const [state, setState] = useState<State>(() => freshState(documentPath));

  useEffect(() => {
    setState(freshState(documentPath));
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
      error: null,
    }));
  }, [documentPath]);

  const submit = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: 'grading', error: null }));
    try {
      const responses = Object.values(state.responses);
      const report = await client.gradeQuiz({
        quiz,
        responses,
        rubric: quiz.rubric,
      });
      const enrichedReport = {
        ...report,
        perQuestion: report.perQuestion.map((item) => {
          const question = quiz.questions.find((q) => q.id === item.questionId);
          if (!question || item.score >= item.maxScore) return item;
          const correctAnswer = question.type === 'mcq'
            ? question.options.filter((option) => option.correct).map((option) => option.text).join(', ')
            : question.type === 'cloze'
              ? question.answers.join(', ')
              : question.answer;
          return { ...item, correctAnswer };
        }),
      };
      setState((prev) => ({ ...prev, phase: 'graded', report: enrichedReport }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Grading failed';
      setState((prev) => ({ ...prev, phase: 'taking', error: message }));
    }
  }, [client, quiz, state.responses]);

  const retake = useCallback(() => {
    setState(freshState(documentPath));
  }, [documentPath]);

  return {
    quiz,
    presented,
    responses: state.responses,
    phase: state.phase,
    report: state.report,
    error: state.error,
    setResponse,
    reshuffle,
    submit,
    retake,
  };
}
