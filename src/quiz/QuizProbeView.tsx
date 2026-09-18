import { useState } from 'react';
import { QuizMarkdown } from './QuizMarkdown';
import type { Probe } from './probe';
import type { QuizQuestion, QuizResponse } from './types';

type Props = {
  probes: Probe[];
  questions: QuizQuestion[];
  responses: Record<string, QuizResponse>;
  busy?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
};

function answerText(response: QuizResponse | undefined): string {
  return response?.type === 'open' || response?.type === 'code' ? response.text : '';
}

/** "Why?" follow-ups the judge asked because an answer was vague or partial. */
export function QuizProbeView({ probes, questions, responses, busy = false, onSubmit, onSkip }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const anyAnswer = probes.some((probe) => (answers[probe.questionId] ?? '').trim());

  return (
    <div className="quiz-take quiz-probe">
      <header className="quiz-take-header">
        <div>
          <div className="quiz-kicker">Follow-up</div>
          <h1>Let&apos;s dig a little deeper</h1>
          <p className="quiz-muted">
            {probes.length === 1 ? 'One answer was' : `${probes.length} answers were`} close but not
            quite there. Explain your thinking; your grade uses both answers.
          </p>
        </div>
      </header>

      <div className="quiz-questions">
        {probes.map((probe) => {
          const question = questions.find((q) => q.id === probe.questionId);
          if (!question) return null;
          return (
            <article key={probe.questionId} className="quiz-card">
              <div className="quiz-md quiz-probe-original">
                <QuizMarkdown>{question.prompt}</QuizMarkdown>
              </div>
              <blockquote className="quiz-probe-answer">
                <span>You said</span>
                {answerText(responses[probe.questionId])}
              </blockquote>
              <div className="quiz-probe-question quiz-md">
                <QuizMarkdown>{probe.followUp}</QuizMarkdown>
              </div>
              <textarea
                className="quiz-open-input"
                rows={4}
                autoFocus={probe === probes[0]}
                disabled={busy}
                placeholder="Explain why…"
                value={answers[probe.questionId] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [probe.questionId]: e.target.value }))}
              />
            </article>
          );
        })}
      </div>

      <div className="quiz-footer-actions">
        <button
          type="button"
          className="quiz-btn primary"
          disabled={busy || !anyAnswer}
          onClick={() => onSubmit(answers)}
        >
          Submit follow-ups
        </button>
        <button type="button" className="quiz-btn" disabled={busy} onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}
