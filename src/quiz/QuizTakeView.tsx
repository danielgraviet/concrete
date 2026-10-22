import type { AiClient } from '../ai/AiClient';
import { QuizGradeView } from './QuizGradeView';
import { QuizQuestionCard } from './QuizQuestionCard';
import { useQuizTake } from './useQuizTake';
import { buildQuizAttempt, type QuizHistoryStore } from './history';
import { quizGradingJobs, withCorrectAnswers } from './gradingJobs';
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
  offlineMode?: boolean;
  onAddQuestionToFlashcards?: (questionId: string) => boolean;
  isQuestionInFlashcards?: (questionId: string) => boolean;
};

export function QuizTakeView({ markdown, documentPath, client, onEdit, historyStore, offlineMode = false, onAddQuestionToFlashcards, isQuestionInFlashcards }: Props) {
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
  } = useQuizTake(markdown, documentPath, client, historyStore, offlineMode);

  const submitDeferredForAi = async (attemptId: string) => {
    const attempt = history.forQuiz(documentPath).find((item) => item.id === attemptId && item.pendingAiGrade);
    if (!attempt?.pendingAiGrade) return;
    const { quiz: savedQuiz, responses: savedResponses } = attempt.pendingAiGrade;
    const fullReport = withCorrectAnswers(await client.gradeQuiz({ quiz: savedQuiz, responses: Object.values(savedResponses), rubric: savedQuiz.rubric }), savedQuiz);
    history.replace(buildQuizAttempt(savedQuiz, fullReport, documentPath, attempt.startedAt, Date.now(), sessionSeed, savedResponses));
    quizGradingJobs.updateReport(documentPath, attemptId, fullReport);
  };
  const canSubmitAiGrade = !offlineMode && !['mock', 'local-echo'].includes(client.getProvider().id);

  const celebration = quizNumber ? (
    <QuizCelebration quizNumber={quizNumber} seed={sessionSeed} />
  ) : null;

  if (phase === 'graded' && report) {
    return (
      <>
        <QuizGradeView report={report} quiz={quiz} responses={responses} sessionSeed={sessionSeed} client={client} onRetake={retake} onEdit={onEdit}
          onAddQuestionToFlashcards={onAddQuestionToFlashcards} isQuestionInFlashcards={isQuestionInFlashcards}
          hasDeferredAiGrade={history.forQuiz(documentPath).some((item) => item.id === sessionSeed && item.pendingAiGrade)}
          canSubmitAiGrade={canSubmitAiGrade} onSubmitAiGrade={() => submitDeferredForAi(sessionSeed)} />
        <div className="quiz-grade-attempts">
          <QuizAttempts store={history} quizPath={documentPath} currentId={sessionSeed} canSubmitAiGrade={canSubmitAiGrade} onSubmitAiGrade={submitDeferredForAi} />
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

      <QuizAttempts store={history} quizPath={documentPath} canSubmitAiGrade={canSubmitAiGrade} onSubmitAiGrade={submitDeferredForAi} />

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
          <p className="quiz-muted">You'll be notified when it's done.</p>
        ) : null}
      </div>
    </div>
  );
}
