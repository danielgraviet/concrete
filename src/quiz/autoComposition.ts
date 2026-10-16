import type { QuizGenerationSettings } from '../settings';

export type AutoQuizCounts = Pick<
  QuizGenerationSettings,
  'mcqCount' | 'clozeCount' | 'openCount' | 'codeCount'
>;

export type AutoQuizAnalysis = AutoQuizCounts & {
  sourceIntent: 'generate' | 'recreate' | 'similar';
};

export type ExistingSourceQuiz = {
  quizPath: string;
  markdown: string;
  counts: AutoQuizCounts;
};

export const AUTO_QUIZ_ANALYSIS_SYSTEM = `Quickly estimate a useful quiz composition from the provided material. Return only one JSON object with integer fields mcqCount, clozeCount, openCount, codeCount, and a sourceIntent string. sourceIntent must be exactly one of: "generate", "recreate", or "similar". Choose "recreate" when the source contains an explicit class quiz, test, or exam that should be transferred into the app. Choose "similar" when the source is already a Concrete quiz (its file path begins with "Quiz ") so the user can practice with new questions. Choose "generate" for ordinary study notes. Count explicit questions by their best-fitting type for quizzes and exams. For notes, make a quick useful guess based on the material. Favor multiple-choice and open-ended questions; use cloze only for concise facts and code only when the source substantially teaches or tests code. Keep total counts at or below 50; rough guesses are fine.`;

export function parseAutoQuizCounts(raw: string): AutoQuizAnalysis {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) throw new Error('The AI did not return a usable quiz estimate. Try again.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('The AI returned an invalid quiz estimate. Try again.');
  }
  const keys = ['mcqCount', 'clozeCount', 'openCount', 'codeCount'] as const;
  const counts = Object.fromEntries(keys.map((key) => {
    const value = Number(parsed[key]);
    return [key, Number.isFinite(value) ? Math.max(0, Math.min(50, Math.round(value))) : 0];
  })) as AutoQuizCounts;
  let remaining = 50;
  for (const key of keys) {
    counts[key] = Math.min(counts[key], remaining);
    remaining -= counts[key];
  }
  const intent = parsed.sourceIntent;
  const sourceIntent = intent === 'recreate' || intent === 'similar' ? intent : 'generate';
  return { ...counts, sourceIntent };
}
