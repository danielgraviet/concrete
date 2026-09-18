import type { GradeReport, QuestionGrade } from './types';

export type Probe = { questionId: string; followUp: string };

/** Probes the judge asked for in a first-pass report. */
export function probesFromReport(report: GradeReport): Probe[] {
  return report.perQuestion.flatMap((item) =>
    item.followUp ? [{ questionId: item.questionId, followUp: item.followUp }] : [],
  );
}

function withoutFollowUp(item: QuestionGrade): QuestionGrade {
  const { followUp: _dropped, ...rest } = item;
  return rest;
}

function totals(report: GradeReport, perQuestion: QuestionGrade[]): GradeReport {
  const score = perQuestion.reduce((sum, item) => sum + item.score, 0);
  const maxScore = perQuestion.reduce((sum, item) => sum + item.maxScore, 0) || 1;
  const percent = Math.round((score / maxScore) * 100);
  return {
    ...report,
    score,
    maxScore,
    percent,
    feedback: report.feedback.replace(/^Graded \d+%/, `Graded ${percent}%`),
    perQuestion,
  };
}

/** Drop unanswered probes so the first-round grades stand as final. */
export function finalizeWithoutProbes(first: GradeReport): GradeReport {
  return totals(first, first.perQuestion.map(withoutFollowUp));
}

/** Replace the probed questions' grades with their second-pass grades. */
export function mergeProbeResults(
  first: GradeReport,
  second: GradeReport,
  answeredIds: ReadonlySet<string>,
): GradeReport {
  const perQuestion = first.perQuestion.map((item) => {
    if (!answeredIds.has(item.questionId)) return withoutFollowUp(item);
    const regraded = second.perQuestion.find((s) => s.questionId === item.questionId);
    return regraded ? withoutFollowUp(regraded) : withoutFollowUp(item);
  });
  return { ...totals(first, perQuestion), stubbed: first.stubbed && second.stubbed };
}
