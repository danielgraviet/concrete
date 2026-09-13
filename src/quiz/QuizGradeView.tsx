import type { GradeReport } from './types';

type Props = {
  report: GradeReport;
  onRetake: () => void;
  onEdit?: () => void;
};

export function QuizGradeView({ report, onRetake, onEdit }: Props) {
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
            <p>{item.feedback}</p>
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
