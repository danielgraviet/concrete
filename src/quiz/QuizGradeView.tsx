import { Fragment, useState } from 'react';
import { runSandboxCode, type SandboxRunResult } from '../sandbox';
import { settingsStore } from '../settings';
import type { AiClient } from '../ai/AiClient';
import { CodeSnippet } from './CodeSnippet';
import { QuizFollowUp } from './QuizFollowUp';
import { QuizMarkdown } from './QuizMarkdown';
import type { CodeQuestion, GradeReport, QuizDocument, QuizQuestion, QuizResponse } from './types';

type Props = {
  report: GradeReport;
  quiz: QuizDocument;
  responses: Record<string, QuizResponse>;
  client: AiClient;
  onRetake: () => void;
  onEdit?: () => void;
};

export function QuizGradeView({ report, quiz, responses, client, onRetake, onEdit }: Props) {
  return (
    <div className="quiz-grade">
      <div className="quiz-grade-summary">
        <div className="quiz-grade-score">
          {report.percent}
          <small>%</small>
        </div>
        <div>
          <strong>
            {report.score.toFixed(report.score % 1 ? 1 : 0)} / {report.maxScore}
          </strong>
          {report.stubbed ? (
            <p className="quiz-muted">Stub grader — connect OpenAI or Anthropic later for rubric scoring.</p>
          ) : null}
          <p>{report.feedback}</p>
        </div>
      </div>
      <ul className="quiz-grade-list">
        {report.perQuestion.map((item, index) => (
          <li key={item.questionId}>
            <div className="quiz-grade-item-head">
              <span>Q{index + 1}</span>
              <span>
                {item.score}/{item.maxScore}
              </span>
            </div>
            <div className="quiz-md">
              <QuizMarkdown>{item.feedback}</QuizMarkdown>
            </div>
            {item.probe ? (
              <div className="quiz-probe-recap quiz-md">
                <strong>Follow-up:</strong> <QuizMarkdown inline>{item.probe.question}</QuizMarkdown>
                <blockquote className="quiz-probe-answer">
                  <span>You said</span>
                  {item.probe.answer}
                </blockquote>
              </div>
            ) : null}
            {item.missing?.length ? (
              <div className="quiz-missing">
                <strong>Not covered yet</strong>
                <ul>
                  {item.missing.map((point) => (
                    <li key={point}>
                      <QuizMarkdown inline>{point}</QuizMarkdown>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {item.correctAnswer ? (
              <div className="quiz-correct-answer quiz-md">
                <strong>Correct answer:</strong> <QuizMarkdown inline>{item.correctAnswer}</QuizMarkdown>
              </div>
            ) : null}
            {(() => {
              const question = quiz.questions.find((q) => q.id === item.questionId);
              const response = responses[item.questionId];
              return (
                <Fragment key={item.questionId}>
                  {question?.type === 'code' ? <CodeReview question={question} /> : null}
                  {item.score < item.maxScore && response && (response.type === 'open' || response.type === 'code') && response.text.trim() && (question?.type === 'open' || (question?.type === 'code' && question.kind !== 'predict-output')) ? (
                    <QuizFollowUp
                      client={client}
                      quiz={quiz}
                      question={question}
                      response={response}
                      responses={Object.values(responses)}
                      feedback={item.feedback}
                      missing={item.missing ?? []}
                    />
                  ) : null}
                </Fragment>
              );
            })()}
          </li>
        ))}
      </ul>
      <div className="quiz-actions">
        <button type="button" className="quiz-btn primary" onClick={onRetake}>
          Retake
        </button>
        {onEdit ? (
          <button type="button" className="quiz-btn" onClick={onEdit}>
            Edit quiz
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Shows the snippet and lets the student run it to see the real behavior. */
function CodeReview({ question }: { question: CodeQuestion }) {
  const [result, setResult] = useState<SandboxRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(
      await runSandboxCode(
        { language: question.language, code: question.snippet, timeoutMs: 8000 },
        settingsStore.get().sandboxProviderId,
      ),
    );
    setRunning(false);
  };

  return (
    <div className="quiz-code-review">
      <CodeSnippet language={question.language} code={question.snippet} />
      {question.explanation ? <p className="quiz-muted">{question.explanation}</p> : null}
      <button type="button" className="quiz-btn" disabled={running} onClick={() => void run()}>
        {running ? 'Running…' : 'Run it'}
      </button>
      {result ? (
        <pre className={`quiz-code-output ${result.ok ? '' : 'error'}`}>
          {result.ok
            ? result.stdout || '(no output)'
            : result.error || result.stderr || 'The code did not run.'}
        </pre>
      ) : null}
    </div>
  );
}
