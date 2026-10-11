import { useState } from 'react';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { Button, Heading, Text } from '@radix-ui/themes';
import { buildOpenAnswerRubric } from '../quiz/openAnswerRubric';
import type { GradeReport } from '../quiz/types';
import type { OpenAnswerGradingStyle } from './types';

type Props = {
  style: OpenAnswerGradingStyle;
  customGuidance: string;
  sampleCount: number;
  onEvaluateRubric?: (rubric: string) => Promise<GradeReport>;
  onBack: () => void;
  onStyleChange: (style: OpenAnswerGradingStyle) => void;
  onGuidanceChange: (guidance: string) => void;
};

const STYLES: ReadonlyArray<{
  id: OpenAnswerGradingStyle;
  title: string;
  description: string;
}> = [
  {
    id: 'supportive',
    title: 'Supportive',
    description: 'Reward sound understanding generously. Minor omissions have a small effect.',
  },
  {
    id: 'balanced',
    title: 'Balanced',
    description: 'Match deductions to what the question asks. Small gaps get small deductions.',
  },
  {
    id: 'rigorous',
    title: 'Rigorous',
    description: 'Expect complete, precise answers. Missing a requested core idea matters more.',
  },
];

export function RubricDashboard({
  style,
  customGuidance,
  sampleCount,
  onEvaluateRubric,
  onBack,
  onStyleChange,
  onGuidanceChange,
}: Props) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<GradeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateStyle = (nextStyle: OpenAnswerGradingStyle) => {
    onStyleChange(nextStyle);
    setReport(null);
    setError(null);
  };
  const updateGuidance = (nextGuidance: string) => {
    onGuidanceChange(nextGuidance);
    setReport(null);
    setError(null);
  };
  const runEvaluation = async () => {
    if (!onEvaluateRubric || running) return;
    setRunning(true);
    setError(null);
    try {
      setReport(await onEvaluateRubric(buildOpenAnswerRubric(style, customGuidance)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run the rubric check.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mv-rubric-dashboard" aria-labelledby="mv-rubric-title">
      <Button type="button" variant="ghost" color="gray" onClick={onBack} className="mv-rubric-back">
        <ArrowLeftIcon />
        Quiz settings
      </Button>
      <header className="mv-rubric-header">
        <Text size="1" color="gray">QUIZ SETTINGS</Text>
        <Heading id="mv-rubric-title" size="6">Open-answer grading</Heading>
        <Text size="2" color="gray">
          Choose how strictly answers are scored. The judge will accept equivalent explanations and
          focus deductions on what each question actually asks.
        </Text>
      </header>

      <div className="mv-rubric-style-grid" role="radiogroup" aria-label="Grading style">
        {STYLES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={style === option.id}
            className={`mv-rubric-style${style === option.id ? ' selected' : ''}`}
            onClick={() => updateStyle(option.id)}
          >
            <span className="mv-rubric-style-title">
              {option.title}{option.id === 'balanced' ? <span>Default</span> : null}
            </span>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      <label className="mv-rubric-guidance">
        <span className="mv-rubric-field-title">Your preferences <span>Optional</span></span>
        <span className="mv-rubric-field-hint">
          Add instructions that fit your subject or learning goals. For example: “Accept diagrams
          described in words” or “Require units in numerical answers.”
        </span>
        <textarea
          rows={5}
          maxLength={2000}
          value={customGuidance}
          onChange={(event) => updateGuidance(event.target.value)}
          placeholder="Add a preference for how your open answers should be graded…"
        />
        <span className="mv-rubric-character-count">{customGuidance.length}/2000</span>
      </label>

      <details className="mv-rubric-preview">
        <summary>What the judge will follow</summary>
        <p>{buildOpenAnswerRubric(style, customGuidance)}</p>
      </details>
      <div className="mv-rubric-evaluation">
        <div>
          <Text size="2" weight="medium">Check this rubric</Text>
          <Text size="1" color="gray">
            Score up to 10 of your latest unique, answered open questions using the selected Tutor AI model.
            {' '}{sampleCount}/10 ready.
          </Text>
        </div>
        <Button type="button" variant="soft" disabled={!onEvaluateRubric || sampleCount === 0 || running} onClick={() => void runEvaluation()}>
          {running ? 'Grading examples…' : 'Run rubric check'}
        </Button>
      </div>
      {sampleCount === 0 ? (
        <Text size="1" color="gray">
          Complete an open-answer quiz to build your sample. New attempts save the question, your answer, and its reference answer locally.
        </Text>
      ) : null}
      {error ? <Text size="1" color="red" role="alert">{error}</Text> : null}
      {report ? (
        <section className="mv-rubric-results" aria-label="Rubric check results">
          <header>
            <Text size="2" weight="medium">Calibration scores</Text>
            <Text size="1" color="gray">
              {report.stubbed ? 'The selected provider returned stub grades.' : `${report.score.toFixed(1)}/${report.maxScore} total`}
            </Text>
          </header>
          <ol>
            {report.perQuestion.map((item, index) => (
              <li key={item.questionId}>
                <div className="mv-rubric-result-score">{index + 1}<strong>{item.score.toFixed(1)}/{item.maxScore}</strong></div>
                <p>{item.feedback}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <Text size="1" color="gray" className="mv-rubric-save-note">
        Changes save automatically and apply to quizzes you generate from now on.
      </Text>
    </section>
  );
}
