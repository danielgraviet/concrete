import { clozeSegments } from './present';
import type {
  ClozeResponse,
  McqResponse,
  OpenResponse,
  PresentedQuestion,
  QuizResponse,
} from './types';

type Props = {
  question: PresentedQuestion;
  index: number;
  total: number;
  response?: QuizResponse;
  onChange: (response: QuizResponse) => void;
};

export function QuizQuestionCard({ question, index, total, response, onChange }: Props) {
  return (
    <article className="quiz-card">
      <header className="quiz-card-head">
        <span className="quiz-card-index">
          Question {index + 1} / {total}
        </span>
        <span className="quiz-card-type">{question.type.toUpperCase()}</span>
      </header>

      {question.type === 'mcq' ? (
        <McqBody
          question={question}
          response={response?.type === 'mcq' ? response : undefined}
          onChange={onChange}
        />
      ) : null}
      {question.type === 'cloze' ? (
        <ClozeBody
          question={question}
          response={response?.type === 'cloze' ? response : undefined}
          onChange={onChange}
        />
      ) : null}
      {question.type === 'open' ? (
        <OpenBody
          question={question}
          response={response?.type === 'open' ? response : undefined}
          onChange={onChange}
        />
      ) : null}
    </article>
  );
}

function McqBody({
  question,
  response,
  onChange,
}: {
  question: Extract<PresentedQuestion, { type: 'mcq' }>;
  response?: McqResponse;
  onChange: (response: QuizResponse) => void;
}) {
  const selected = new Set(response?.selectedIds ?? []);
  const multi = question.options.filter((o) => o.correct).length > 1;

  const toggle = (id: string) => {
    if (multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ questionId: question.id, type: 'mcq', selectedIds: [...next] });
      return;
    }
    onChange({ questionId: question.id, type: 'mcq', selectedIds: [id] });
  };

  return (
    <div className="quiz-mcq">
      <p className="quiz-prompt">{question.prompt}</p>
      <div className="quiz-options" role={multi ? 'group' : 'radiogroup'}>
        {question.options.map((opt) => {
          const checked = selected.has(opt.id);
          return (
            <label key={opt.id} className={`quiz-option ${checked ? 'selected' : ''}`}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={question.id}
                checked={checked}
                onChange={() => toggle(opt.id)}
              />
              <span className="quiz-option-letter">{opt.letter}</span>
              <span>{opt.text}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ClozeBody({
  question,
  response,
  onChange,
}: {
  question: Extract<PresentedQuestion, { type: 'cloze' }>;
  response?: ClozeResponse;
  onChange: (response: QuizResponse) => void;
}) {
  const fills = response?.fills ?? question.answers.map(() => '');
  const segments = clozeSegments(question.prompt);

  const setFill = (blankIndex: number, value: string) => {
    const next = [...fills];
    while (next.length <= blankIndex) next.push('');
    next[blankIndex] = value;
    onChange({ questionId: question.id, type: 'cloze', fills: next });
  };

  return (
    <div className="quiz-cloze">
      <p className="quiz-prompt quiz-cloze-prompt">
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <input
              key={i}
              className="quiz-cloze-input"
              value={fills[seg.index] ?? ''}
              onChange={(e) => setFill(seg.index, e.target.value)}
              aria-label={`Blank ${seg.index + 1}`}
            />
          ),
        )}
      </p>
    </div>
  );
}

function OpenBody({
  question,
  response,
  onChange,
}: {
  question: Extract<PresentedQuestion, { type: 'open' }>;
  response?: OpenResponse;
  onChange: (response: QuizResponse) => void;
}) {
  return (
    <div className="quiz-open">
      <p className="quiz-prompt">{question.prompt}</p>
      <textarea
        className="quiz-open-input"
        rows={5}
        placeholder="Write your answer…"
        value={response?.text ?? ''}
        onChange={(e) =>
          onChange({ questionId: question.id, type: 'open', text: e.target.value })
        }
      />
    </div>
  );
}
