import type { QuizGenerationSettings } from '../settings';

export type AutoQuizCounts = Pick<
  QuizGenerationSettings,
  'mcqCount' | 'clozeCount' | 'openCount' | 'codeCount'
>;

export const AUTO_QUIZ_ANALYSIS_SYSTEM = `You analyze study material to plan a quiz. Return only one JSON object with integer fields mcqCount, clozeCount, openCount, and codeCount. Do not include markdown or explanation. Count explicit questions by their best-fitting type when the material is an exam or question set. When it is notes rather than an existing quiz, estimate a useful number and mix based on the amount and variety of content. Favor multiple-choice and open-ended questions; use cloze only for concise, unambiguous facts and code only when the source substantially teaches or tests code. If there is no suitable material for a type, return zero. Keep the total at or below 50. Do not create more questions than can be supported by the source.`;

export function parseAutoQuizCounts(raw: string): AutoQuizCounts {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) throw new Error('The AI did not return a usable question count. Try again or enter counts manually.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('The AI returned invalid question counts. Try again or enter counts manually.');
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
  if (remaining === 50) throw new Error('No suitable questions were found in the selected sources. Try different pages or enter counts manually.');
  return counts;
}
