import { useState } from 'react';
import type { AiClient } from '../ai/AiClient';
import type { CodeQuestion, GradeQuizRequest, OpenQuestion, QuizDocument, QuizResponse } from './types';
import { QuizMarkdown } from './QuizMarkdown';

type Props = {
  client: AiClient;
  quiz: QuizDocument;
  question: OpenQuestion | CodeQuestion;
  response: QuizResponse & { text: string };
  responses: QuizResponse[];
  feedback: string;
  missing: string[];
};

type FollowUpResult = { score: number; maxScore: number; feedback: string };

export function QuizFollowUp({ client, quiz, question, response, responses, feedback, missing }: Props) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'grade' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy('prepare');
    setError(null);
    try {
      const nextPrompt = await client.generateQuizFollowUp({
        question: question.prompt,
        studentAnswer: response.text,
        feedback,
        missing,
      });
      setPrompt(nextPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare a follow-up.');
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    if (!answer.trim()) return;
    setBusy('grade');
    setError(null);
    try {
      const request: GradeQuizRequest = {
        quiz,
        responses,
        rubric: quiz.rubric,
        followUps: [{ questionId: question.id, question: prompt, answer: answer.trim() }],
      };
      const report = await client.gradeQuiz(request);
      const grade = report.perQuestion.find((item) => item.questionId === question.id);
      if (!grade) throw new Error('The follow-up could not be graded.');
      setResult({ score: grade.score, maxScore: grade.maxScore, feedback: grade.feedback });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grade the follow-up.');
    } finally {
      setBusy(null);
    }
  };

  if (result) {
    return (
      <div className="quiz-followup-result" aria-live="polite">
        <p><strong>Optional practice · {result.score}/{result.maxScore}</strong></p>
        <QuizMarkdown>{result.feedback}</QuizMarkdown>
        <p className="quiz-muted">This practice answer does not change your quiz score.</p>
      </div>
    );
  }

  return (
    <div className="quiz-followup">
      {!prompt ? (
        <button type="button" className="quiz-btn" disabled={busy !== null} onClick={() => void start()}>
          {busy === 'prepare' ? 'Preparing follow-up…' : 'Dig deeper (optional)'}
        </button>
      ) : (
        <>
          <div className="quiz-probe-question quiz-md"><QuizMarkdown>{prompt}</QuizMarkdown></div>
          <textarea
            className="quiz-open-input"
            rows={3}
            disabled={busy !== null}
            placeholder="Explain your thinking…"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <button type="button" className="quiz-btn" disabled={busy !== null || !answer.trim()} onClick={() => void check()}>
            {busy === 'grade' ? 'Checking…' : 'Check follow-up'}
          </button>
        </>
      )}
      {error ? <p className="quiz-error" role="alert">{error}</p> : null}
    </div>
  );
}
