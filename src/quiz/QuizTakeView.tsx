import type { AiClient } from '../ai/AiClient';
import { QuizGradeView } from './QuizGradeView';
import { QuizQuestionCard } from './QuizQuestionCard';
import { useQuizTake } from './useQuizTake';

type Props = {
  markdown: string;
  documentPath: string;
  client: AiClient;
  onEdit: () => void;
};

export function QuizTakeView({ markdown, documentPath, client, onEdit }: Props) {
  const {
    quiz,
    presented,
    responses,
    phase,
    report,
    error,
    setResponse,
    reshuffle,
    submit,
    retake,
  } = useQuizTake(markdown, documentPath, client);

  if (phase === 'graded' && report) {
    return <QuizGradeView report={report} onRetake={retake} onEdit={onEdit} />;
  }

  return (
    <div className="quiz-take">
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
          onClick={() => void submit()}
        >
          {phase === 'grading' ? 'Grading…' : 'Submit for grading'}
        </button>
        <p className="quiz-muted">Graded with a stub rubric until an API key is configured.</p>
      </div>
    </div>
  );
}
