type Props = {
  markdown: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onTake: () => void;
};

/** Simple source editor for quiz markdown (v1 — structured, not WYSIWYG). */
export function QuizEditView({ markdown, onChange, onBlur, onTake }: Props) {
  return (
    <div className="quiz-edit">
      <header className="quiz-take-header">
        <div>
          <div className="quiz-kicker">Edit quiz</div>
          <p className="quiz-muted">
            Markdown source. MCQ options use <code>- [ ]</code> / <code>- [x]</code>. Letters are
            assigned only when taking the quiz.
          </p>
        </div>
        <div className="quiz-actions">
          <button type="button" className="quiz-btn primary" onClick={onTake}>
            Take quiz
          </button>
        </div>
      </header>
      <textarea
        className="quiz-source"
        value={markdown}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        spellCheck={false}
      />
    </div>
  );
}
