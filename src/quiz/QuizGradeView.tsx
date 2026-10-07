import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalize } from '../ai/quizStubs';
import { runSandboxCode, type SandboxRunResult } from '../sandbox';
import { settingsStore } from '../settings';
import type { AiClient } from '../ai/AiClient';
import { CodeSnippet } from './CodeSnippet';
import { normalizeOutput } from './codeOutput';
import { QuizFollowUp } from './QuizFollowUp';
import { QuizInlineText, QuizMarkdown } from './QuizMarkdown';
import { CODE_KIND_LABEL } from './QuizQuestionCard';
import { clozeSegments, presentQuiz } from './present';
import type {
  CodeQuestion,
  GradeReport,
  PresentedQuestion,
  QuestionGrade,
  QuizDocument,
  QuizResponse,
} from './types';

type Props = {
  report: GradeReport;
  quiz: QuizDocument;
  responses: Record<string, QuizResponse>;
  /** Same seed used while taking, so choice order matches what they saw. */
  sessionSeed: string;
  client: AiClient;
  onRetake: () => void;
  onEdit?: () => void;
};

export function QuizGradeView({ report, quiz, responses, sessionSeed, client, onRetake, onEdit }: Props) {
  const scoreSummaryRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const summary = scoreSummaryRef.current;
      const page = summary?.closest<HTMLElement>('.editor-wrap');
      if (page) page.scrollTop = 0;
      else summary?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const presented = useMemo(() => presentQuiz(quiz, sessionSeed), [quiz, sessionSeed]);
  const presentedById = useMemo(
    () => new Map(presented.map((question) => [question.id, question])),
    [presented],
  );

  return (
    <div className="quiz-grade">
      <div ref={scoreSummaryRef} className="quiz-grade-summary">
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
            <GradedQuestion
              question={presentedById.get(item.questionId)}
              index={index}
              total={report.perQuestion.length}
              grade={item}
              response={responses[item.questionId]}
            />
            <div className="quiz-md quiz-grade-feedback">
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
            {(() => {
              const question = quiz.questions.find((q) => q.id === item.questionId);
              const response = responses[item.questionId];
              return (
                <Fragment key={item.questionId}>
                  {question?.type === 'code' ? <CodeReview question={question} hideSnippet /> : null}
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

/** The question as it was shown, with the correct answer in green and a wrong guess in red. */
function GradedQuestion({
  question,
  index,
  total,
  grade,
  response,
}: {
  question?: PresentedQuestion;
  index: number;
  total: number;
  grade: QuestionGrade;
  response?: QuizResponse;
}) {
  if (!question) return null;
  const earned = grade.score >= grade.maxScore;
  return (
    <article className="quiz-card quiz-grade-replay">
      <header className="quiz-card-head">
        <span className="quiz-card-index">
          Question {index + 1} / {total}
        </span>
        <span className="quiz-card-type">{question.type.toUpperCase()}</span>
      </header>
      {question.type === 'mcq' ? (
        <GradedMcq question={question} response={response?.type === 'mcq' ? response : undefined} />
      ) : null}
      {question.type === 'cloze' ? (
        <GradedCloze question={question} response={response?.type === 'cloze' ? response : undefined} />
      ) : null}
      {question.type === 'open' ? (
        <GradedWritten
          prompt={question.prompt}
          guess={response?.type === 'open' ? response.text : ''}
          correct={question.answer}
          earned={earned}
        />
      ) : null}
      {question.type === 'code' ? (
        <GradedCode question={question} response={response?.type === 'code' ? response : undefined} earned={earned} />
      ) : null}
    </article>
  );
}

function GradedMcq({
  question,
  response,
}: {
  question: Extract<PresentedQuestion, { type: 'mcq' }>;
  response?: Extract<QuizResponse, { type: 'mcq' }>;
}) {
  const selected = new Set(response?.selectedIds ?? []);
  return (
    <div className="quiz-mcq">
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{question.prompt}</QuizMarkdown>
      </div>
      <div className="quiz-options">
        {question.options.map((opt) => {
          const picked = selected.has(opt.id);
          const mark = opt.correct ? 'correct' : picked ? 'wrong' : '';
          return (
            <div key={opt.id} className={`quiz-option review ${mark}`}>
              <span className="quiz-option-letter">{opt.letter}</span>
              <span className="quiz-md quiz-option-text">
                <QuizMarkdown inline>{opt.text}</QuizMarkdown>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradedCloze({
  question,
  response,
}: {
  question: Extract<PresentedQuestion, { type: 'cloze' }>;
  response?: Extract<QuizResponse, { type: 'cloze' }>;
}) {
  const fills = response?.fills ?? [];
  return (
    <p className="quiz-prompt quiz-cloze-prompt quiz-md">
      {clozeSegments(question.prompt).map((seg, i) => {
        if (seg.type === 'text') return <QuizInlineText key={i} text={seg.value} />;
        const guess = fills[seg.index] ?? '';
        const right = seg.answer;
        if (normalize(guess) === normalize(right)) {
          return (
            <mark key={i} className={`quiz-grade-chip right${seg.code ? ' code' : ''}`}>
              {guess.trim() || right}
            </mark>
          );
        }
        return (
          <span key={i} className="quiz-grade-blank">
            <mark className={`quiz-grade-chip wrong${seg.code ? ' code' : ''}`}>
              {guess.trim() || 'blank'}
            </mark>
            <mark className={`quiz-grade-chip right${seg.code ? ' code' : ''}`}>{right}</mark>
          </span>
        );
      })}
    </p>
  );
}

function GradedWritten({
  prompt,
  guess,
  correct,
  earned,
}: {
  prompt: string;
  guess: string;
  correct: string;
  earned: boolean;
}) {
  return (
    <div className="quiz-open">
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{prompt}</QuizMarkdown>
      </div>
      <div className={`quiz-grade-write ${earned ? 'right' : 'wrong'}`}>
        {guess.trim() ? guess : 'Left blank'}
      </div>
      {earned ? null : (
        <div className="quiz-grade-write right">
          <span>Correct answer</span>
          {correct}
        </div>
      )}
    </div>
  );
}

function GradedCode({
  question,
  response,
  earned,
}: {
  question: CodeQuestion;
  response?: Extract<QuizResponse, { type: 'code' }>;
  earned: boolean;
}) {
  const guess = response?.text ?? '';
  const matched = question.kind === 'predict-output'
    ? normalizeOutput(guess) === normalizeOutput(question.expected)
    : earned;
  return (
    <div className="quiz-code-question">
      <div className="quiz-code-kind">{CODE_KIND_LABEL[question.kind]}</div>
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{question.prompt}</QuizMarkdown>
      </div>
      {question.snippet.trim() ? <CodeSnippet language={question.language} code={question.snippet} /> : null}
      <div className={`quiz-grade-write ${matched ? 'right' : 'wrong'}`}>
        {guess.trim() ? guess : 'Left blank'}
      </div>
      {matched ? null : (
        <div className="quiz-grade-write right">
          <span>Correct answer</span>
          {question.expected}
        </div>
      )}
    </div>
  );
}

/** Shows the snippet and lets the student run it to see the real behavior. */
function CodeReview({ question, hideSnippet = false }: { question: CodeQuestion; hideSnippet?: boolean }) {
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
      {hideSnippet ? null : <CodeSnippet language={question.language} code={question.snippet} />}
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
