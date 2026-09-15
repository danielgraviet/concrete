/** App settings — appearance driven by named theme packs + Radix Themes. */

import {
  DEFAULT_THEME_PACK,
  isThemePackId,
  type ThemePackId,
} from './themePacks';

export type { ThemePackId } from './themePacks';

/** @deprecated Prefer ThemePackId — kept for reading legacy localStorage. */
export type Appearance = 'dark' | 'light';

export type AgentProviderId = 'off' | 'codex' | 'claude';

export type QuizDifficulty = 'easy' | 'medium' | 'hard';

export type QuizGenerationSettings = {
  mcqCount: number;
  clozeCount: number;
  openCount: number;
  difficulty: QuizDifficulty;
  /** Optional frontmatter / grading rubric override. */
  customRubric: string;
};

export type AppSettings = {
  themePack: ThemePackId;
  autosaveMs: number;
  providerId: string;
  /** OpenRouter model id when provider is openrouter. */
  openRouterModelId: string;
  /** BYO coding agent: off | codex | claude */
  agentProviderId: AgentProviderId;
  quiz: QuizGenerationSettings;
};

export const DEFAULT_QUIZ_SETTINGS: QuizGenerationSettings = {
  mcqCount: 2,
  clozeCount: 1,
  openCount: 1,
  difficulty: 'medium',
  customRubric:
    'Score correctness and conceptual understanding. Give partial credit for mostly correct answers, and require the key ideas from the reference answer. Be concise and explain what is missing.',
};

export const DEFAULT_SETTINGS: AppSettings = {
  themePack: DEFAULT_THEME_PACK,
  autosaveMs: 800,
  providerId: 'mock',
  openRouterModelId: 'openai/gpt-4o-mini',
  agentProviderId: 'off',
  quiz: { ...DEFAULT_QUIZ_SETTINGS },
};

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return value === 'off' || value === 'codex' || value === 'claude';
}

export function resolveAgentProviderId(value: unknown): AgentProviderId {
  return isAgentProviderId(value) ? value : DEFAULT_SETTINGS.agentProviderId;
}

export function isQuizDifficulty(value: unknown): value is QuizDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function clampQuizCount(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(20, Math.round(n)));
}

export function resolveQuizSettings(value: unknown): QuizGenerationSettings {
  const raw =
    value && typeof value === 'object' ? (value as Partial<QuizGenerationSettings>) : {};
  const next: QuizGenerationSettings = {
    mcqCount: clampQuizCount(raw.mcqCount, DEFAULT_QUIZ_SETTINGS.mcqCount),
    clozeCount: clampQuizCount(raw.clozeCount, DEFAULT_QUIZ_SETTINGS.clozeCount),
    openCount: clampQuizCount(raw.openCount, DEFAULT_QUIZ_SETTINGS.openCount),
    difficulty: isQuizDifficulty(raw.difficulty)
      ? raw.difficulty
      : DEFAULT_QUIZ_SETTINGS.difficulty,
    customRubric:
      typeof raw.customRubric === 'string'
        ? raw.customRubric.slice(0, 500)
        : DEFAULT_QUIZ_SETTINGS.customRubric,
  };
  // Keep at least one question type enabled.
  if (next.mcqCount + next.clozeCount + next.openCount === 0) {
    next.mcqCount = 1;
  }
  return next;
}

export function isAppearance(value: unknown): value is Appearance {
  return value === 'dark' || value === 'light';
}

/** Resolve theme pack from new or legacy settings payloads. */
export function resolveThemePack(parsed: {
  themePack?: unknown;
  appearance?: unknown;
  theme?: unknown;
}): ThemePackId {
  if (isThemePackId(parsed.themePack)) return parsed.themePack;
  // Legacy ids
  if (parsed.themePack === 'default' || parsed.theme === 'default') return 'concrete';
  if (parsed.theme === 'martian' || parsed.theme === 'paper-light') return 'martian';
  if (parsed.theme === 'daytona') return 'daytona';
  if (parsed.theme === 'concrete') return 'concrete';
  if (parsed.appearance === 'light') return 'martian';
  if (parsed.appearance === 'dark') return 'concrete';
  return DEFAULT_THEME_PACK;
}
