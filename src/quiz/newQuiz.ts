/**
 * Pure helpers behind the New quiz dialog: size presets, scaling the detected
 * question mix to a preset, where the quiz is saved, and per-file labels.
 */
import type { AutoQuizCounts } from './autoComposition';
import { SOURCES_FOLDER } from './quizSources';

export type QuizSizePreset = { id: 'quick' | 'standard' | 'exam'; label: string; total: number };

export const QUIZ_SIZE_PRESETS: readonly QuizSizePreset[] = [
  { id: 'quick', label: 'Quick', total: 10 },
  { id: 'standard', label: 'Standard', total: 20 },
  { id: 'exam', label: 'Exam', total: 40 },
];

const COUNT_KEYS = ['mcqCount', 'clozeCount', 'openCount', 'codeCount'] as const;

/**
 * Scale a question mix to `total`, keeping its proportions (largest remainder,
 * so the sum is exact). Types the mix left at zero stay zero; an empty mix
 * becomes all multiple choice.
 */
export function scaleQuizCounts(mix: AutoQuizCounts, total: number): AutoQuizCounts {
  const target = Math.max(0, Math.round(total));
  const sum = COUNT_KEYS.reduce((acc, key) => acc + Math.max(0, mix[key]), 0);
  if (sum === 0) return { mcqCount: target, clozeCount: 0, openCount: 0, codeCount: 0 };

  const exact = COUNT_KEYS.map((key) => (Math.max(0, mix[key]) / sum) * target);
  const floored = exact.map(Math.floor);
  let leftover = target - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .filter(({ index }) => mix[COUNT_KEYS[index]] > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; leftover > 0 && order.length > 0; i = (i + 1) % order.length, leftover -= 1) {
    floored[order[i].index] += 1;
  }
  return {
    mcqCount: floored[0],
    clozeCount: floored[1],
    openCount: floored[2],
    codeCount: floored[3],
  };
}

/** Folder for a new quiz: beside its first source, except sources in `Sources/` or the root. */
export function quizSaveFolder(primarySource: string, workingFolder: string): string {
  if (primarySource.startsWith(`${SOURCES_FOLDER}/`)) return workingFolder;
  const slash = primarySource.lastIndexOf('/');
  return slash > 0 ? primarySource.slice(0, slash) : workingFolder;
}

/** Short status for an added file, e.g. "24 slides". */
export function sourceStatusLabel(source: { kind: 'pptx' | 'pdf'; unitCount: number | null }): string {
  if (source.kind === 'pdf') return 'PDF';
  const n = source.unitCount ?? 0;
  return `${n} ${n === 1 ? 'slide' : 'slides'}`;
}

/** File types the dialog's drop zone takes. */
export function canAddAsQuizSource(name: string): boolean {
  return /[^/\\]\.(pptx|pdf)$/i.test(name);
}

/** `accept` value for the dialog's file picker. */
export const QUIZ_SOURCE_ACCEPT =
  '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,application/pdf';
