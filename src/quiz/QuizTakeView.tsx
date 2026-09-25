import type { AiClient } from '../ai/AiClient';
import { QuizGradeView } from './QuizGradeView';
import { QuizQuestionCard } from './QuizQuestionCard';
import { useQuizTake } from './useQuizTake';
import type { QuizHistoryStore } from './history';
import { ProgressPanel } from './ProgressPanel';
import { QuizAttempts } from './QuizAttempts';
import { QuizCelebration } from './QuizCelebration';
import { folderOf } from './progressStats';

type Props = {
  markdown: string;
  documentPath: string;
  client: AiClient;
  onEdit: () => void;
  historyStore?: QuizHistoryStore;
};

export function QuizTakeView({ markdown, documentPath, client, onEdit, historyStore }: Props) {
  const {
    quiz,
    presented,
    responses,
    phase,
    report,
    error,
    sessionSeed,
    quizNumber,
    history,
    setResponse,
    reshuffle,
    submit,
    retake,
  } = useQuizTake(markdown, documentPath, client, historyStore);

  const celebration = quizNumber ? (
    <QuizCelebration quizNumber={quizNumber} seed={sessionSeed} />
  ) : null;

  if (phase === 'graded' && report) {
    return (
      <>
        {celebration}
        <QuizGradeView report={report} quiz={quiz} responses={responses} client={client} onRetake={retake} onEdit={onEdit} />
        <div className="quiz-grade-attempts">
          <QuizAttempts store={history} quizPath={documentPath} currentId={sessionSeed} />
        </div>
        {historyStore ? <ProgressPanel store={historyStore} folder={folderOf(documentPath)} /> : null}
      </>
    );
  }

  return (
    <div className="quiz-take">
      {phase === 'grading' ? celebration : null}
      <header className="quiz-take-header">
        <div>
          <div className="quiz-kicker">Quiz</div>
          <h1>{quiz.title}</h1>
          {quiz.source ? <p className="quiz-muted">From {quiz.source}</p> : null}
        </div>
        <div className="quiz-actions">
          <button type="button" className="quiz-btn" onClick={reshuffle} title="Reshuffle choices">
            Shuffle
          </button>
          <button type="button" className="quiz-btn" onClick={onEdit}>
            Edit
          </button>
        </div>
      </header>

      <QuizAttempts store={history} quizPath={documentPath} />

      <div className="quiz-questions">
        {presented.map((question, index) => (
          <QuizQuestionCard
            key={question.id}
            question={question}
            index={index}
            total={presented.length}
            response={responses[question.id]}
            onChange={setResponse}
          />
        ))}
      </div>

      {error ? <p className="quiz-error">{error}</p> : null}

      <div className="quiz-footer-actions">
        <button
          type="button"
          className="quiz-btn primary"
          disabled={phase === 'grading' || presented.length === 0}
          onClick={submit}
        >
          {phase === 'grading' ? 'Grading…' : 'Submit for grading'}
        </button>
        {phase === 'grading' ? (
          <p className="quiz-muted">Grading keeps running if you open another note — you'll be notified when it's done.</p>
        ) : null}
        <p className="quiz-muted">Graded with a stub rubric until an API key is configured.</p>
      </div>
    </div>
  );
}
