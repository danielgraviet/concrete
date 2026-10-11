import type { QuizAttempt } from './history';
import type { OpenQuestion, OpenResponse } from './types';

export type RubricCalibrationSample = {
  question: OpenQuestion;
  response: OpenResponse;
};

/** Select the latest unique, answered open questions with stored reference answers. */
export function getRecentOpenAnswerSamples(
  attempts: readonly QuizAttempt[],
  limit = 10,
): RubricCalibrationSample[] {
  const maxSamples = Math.max(0, Math.floor(limit));
  if (maxSamples === 0) return [];
  const samples: RubricCalibrationSample[] = [];
  const seenPrompts = new Set<string>();
  const newestFirst = [...attempts].sort((a, b) => b.completedAt - a.completedAt);

  for (const attempt of newestFirst) {
    for (const item of attempt.perQuestion) {
      const referenceAnswer = item.referenceAnswer?.trim() || item.correctAnswer?.trim();
      if (item.type !== 'open' || !item.prompt?.trim() || !item.answer?.trim() || !referenceAnswer) {
        continue;
      }
      const normalizedPrompt = item.prompt.trim().replace(/\s+/g, ' ').toLowerCase();
      if (seenPrompts.has(normalizedPrompt)) continue;
      seenPrompts.add(normalizedPrompt);

      const id = `rubric-calibration-${samples.length + 1}`;
      samples.push({
        question: { id, type: 'open', prompt: item.prompt, answer: referenceAnswer },
        response: { questionId: id, type: 'open', text: item.answer },
      });
      if (samples.length >= maxSamples) return samples;
    }
  }
  return samples;
}
