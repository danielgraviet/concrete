import type { QuizResponse } from './types';

/** An unfinished quiz attempt, kept until the student submits it. */
export type QuizDraft = {
  version: 1;
  path: string;
  sessionSeed: string;
  startedAt: number;
  responses: Record<string, QuizResponse>;
};

function draftKey(vaultRoot: string, path: string): string {
  return `mv:quiz-draft:${vaultRoot || '__default__'}:${path}`;
}

export function loadQuizDraft(vaultRoot: string, path: string): QuizDraft | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftKey(vaultRoot, path)) || '') as QuizDraft;
    if (parsed?.version !== 1 || parsed.path !== path) return null;
    if (typeof parsed.sessionSeed !== 'string' || typeof parsed.startedAt !== 'number') return null;
    if (!parsed.responses || typeof parsed.responses !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveQuizDraft(
  vaultRoot: string,
  draft: Omit<QuizDraft, 'version'>,
): void {
  try {
    const stored: QuizDraft = { version: 1, ...draft };
    localStorage.setItem(draftKey(vaultRoot, draft.path), JSON.stringify(stored));
  } catch {
    // Progress storage is best-effort.
  }
}

export function clearQuizDraft(vaultRoot: string, path: string): void {
  try {
    localStorage.removeItem(draftKey(vaultRoot, path));
  } catch {
    // Progress storage is best-effort.
  }
}
