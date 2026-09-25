import { useEffect, useState } from 'react';
import type { QuestionAttempt, QuizAttempt, QuizHistoryStore } from './history';
import { QuizMarkdown } from './QuizMarkdown';

type Props = {
  store: QuizHistoryStore;
  quizPath: string;
  /** Id of the attempt on screen right now, labelled "This attempt". */
  currentId?: string;
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

function formatScore(score: number): string {
  return score.toFixed(score % 1 ? 1 : 0);
}

function gradeClass(score: number, maxScore: number): string {
  if (score >= maxScore) return 'right';
  return score > 0 ? 'partial' : 'wrong';
}

/** Earlier attempts at this quiz: score per attempt, then answers and feedback on demand. */
export function QuizAttempts({ store, quizPath, currentId }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => store.subscribe(() => refresh((n) => n + 1)), [store]);

  const attempts = store.forQuiz(quizPath);
  if (attempts.length === 0) return null;

  const best = Math.max(...attempts.map((a) => a.percent));
  const times = attempts.length === 1 ? 'once' : `${attempts.length} times`;

  return (
    <details className="quiz-attempts">
      <summary>
        <span className="quiz-attempts-title">Past attempts</span>
        <span className="quiz-muted">
          Taken {times} · best {best}% · last {attempts[0].percent}%
        </span>
      </summary>
      <ol className="quiz-attempts-list">
        {attempts.map((attempt, index) => (
          <AttemptRow
            key={attempt.id}
            attempt={attempt}
            number={attempts.length - index}
            isCurrent={attempt.id === currentId}
          />
        ))}
      </ol>
    </details>
  );
}

function AttemptRow({ attempt, number, isCurrent }: { attempt: QuizAttempt; number: number; isCurrent: boolean }) {
  const hasDetails = attempt.perQuestion.some((q) => q.prompt !== undefined);
  return (
    <li>
      <details className="quiz-attempt">
        <summary>
          <span className="quiz-attempt-name">
            Attempt {number}
            {isCurrent ? <em> · this attempt</em> : null}
          </span>
          <span className="quiz-muted">{dateFormat.format(attempt.completedAt)}</span>
          <span className={`quiz-attempt-score ${gradeClass(attempt.score, attempt.maxScore)}`}>
            {attempt.percent}%
            <small> {formatScore(attempt.score)}/{attempt.maxScore}</small>
          </span>
        </summary>
        {hasDetails ? (
          <ol className="quiz-attempt-questions">
            {attempt.perQuestion.map((q, index) => (
              <AttemptQuestion key={q.questionId} item={q} index={index} />
            ))}
          </ol>
        ) : (
          <p className="quiz-muted">Answers weren't saved for this attempt — only the score.</p>
        )}
      </details>
    </li>
  );
}

function AttemptQuestion({ item, index }: { item: QuestionAttempt; index: number }) {
  return (
    <li className={`quiz-attempt-q ${gradeClass(item.score, item.maxScore)}`}>
      <div className="quiz-attempt-q-head">
        <span>Q{index + 1}</span>
        <span>{formatScore(item.score)}/{item.maxScore}</span>
      </div>
      {item.prompt ? (
        <div className="quiz-md quiz-attempt-prompt"><QuizMarkdown>{item.prompt}</QuizMarkdown></div>
      ) : null}
      <div className="quiz-attempt-field">
        <span>Your answer</span>
        {item.answer ? <p className="quiz-attempt-answer">{item.answer}</p> : <p className="quiz-muted">(left blank)</p>}
      </div>
      {item.feedback ? (
        <div className="quiz-attempt-field quiz-md">
          <span>Feedback</span>
          <QuizMarkdown>{item.feedback}</QuizMarkdown>
        </div>
      ) : null}
      {item.correctAnswer ? (
        <div className="quiz-attempt-field quiz-md">
          <span>Correct answer</span>
          <QuizMarkdown inline>{item.correctAnswer}</QuizMarkdown>
        </div>
      ) : null}
    </li>
  );
}
