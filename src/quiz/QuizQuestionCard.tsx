import { clozeSegments } from './present';
import { CodeSnippet } from './CodeSnippet';
import { QuizMarkdown } from './QuizMarkdown';
import type {
  ClozeResponse,
  CodeKind,
  CodeResponse,
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
      {question.type === 'code' ? (
        <CodeBody
          question={question}
          response={response?.type === 'code' ? response : undefined}
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
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{question.prompt}</QuizMarkdown>
      </div>
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
              <span className="quiz-md quiz-option-text">
                <QuizMarkdown inline>{opt.text}</QuizMarkdown>
              </span>
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
            <span key={i} className="quiz-md">
              <QuizMarkdown inline>{seg.value}</QuizMarkdown>
            </span>
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
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{question.prompt}</QuizMarkdown>
      </div>
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

export const CODE_KIND_LABEL: Record<CodeKind, string> = {
  'predict-output': 'Predict the output',
  'find-bug': 'Find the bug',
  complexity: 'Time complexity',
  scale: 'What happens at scale?',
};

const CODE_PLACEHOLDER: Record<CodeKind, string> = {
  'predict-output': 'Exactly what gets printed…',
  'find-bug': 'What is the bug, and how would you fix it?',
  complexity: 'Big-O, and why…',
  scale: 'What breaks as the input grows? What would you change, and why?',
};

function CodeBody({
  question,
  response,
  onChange,
}: {
  question: Extract<PresentedQuestion, { type: 'code' }>;
  response?: CodeResponse;
  onChange: (response: QuizResponse) => void;
}) {
  return (
    <div className="quiz-code-question">
      <div className="quiz-code-kind">
        {CODE_KIND_LABEL[question.kind]}
        {question.verified ? (
          <span className="quiz-code-verified" title="The expected output came from running this code">
            Verified by running
          </span>
        ) : null}
      </div>
      <div className="quiz-prompt quiz-md">
        <QuizMarkdown>{question.prompt}</QuizMarkdown>
      </div>
      {question.snippet.trim() ? (
        <CodeSnippet language={question.language} code={question.snippet} />
      ) : null}
      <textarea
        className="quiz-open-input quiz-code-input"
        rows={question.kind === 'predict-output' ? 3 : question.kind === 'scale' ? 7 : 4}
        spellCheck={false}
        placeholder={CODE_PLACEHOLDER[question.kind]}
        value={response?.text ?? ''}
        onChange={(e) =>
          onChange({ questionId: question.id, type: 'code', text: e.target.value })
        }
      />
    </div>
  );
}
