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

export const BRAND_LOGOS = [
  { id: 'triple-c', label: 'Triple C', description: 'Compact geometric mark' },
  { id: 'square-boxy', label: 'Square boxy', description: 'Stacked symbol with wordmark' },
  { id: 'cinderblock', label: 'Cinderblock', description: 'Interlocking block mark with wordmark' },
  { id: 'full-text-blocks', label: 'Full text blocks', description: 'Geometric Concrete wordmark' },
] as const;
export type BrandLogoId = (typeof BRAND_LOGOS)[number]['id'];

export function isBrandLogoId(value: unknown): value is BrandLogoId {
  return BRAND_LOGOS.some((logo) => logo.id === value);
}

export type QuizGenerationSettings = {
  mcqCount: number;
  clozeCount: number;
  openCount: number;
  codeCount: number;
  difficulty: QuizDifficulty;
  /** Optional frontmatter / grading rubric override. */
  customRubric: string;
};

export type ReviewSettings = {
  /** FSRS target probability of recall when a card comes due (0.7–0.97). */
  retention: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Type cloze answers instead of just revealing them. */
  typeCloze: boolean;
};

export type AppSettings = {
  themePack: ThemePackId;
  brandLogo: BrandLogoId;
  autosaveMs: number;
  /** Tutor/quiz model backend: openrouter | claude | codex | mock | local-echo. */
  providerId: string;
  /** OpenRouter model id when provider is openrouter. */
  openRouterModelId: string;
  /** Claude Code model alias when provider is claude. */
  claudeModelId: string;
  /** BYO coding agent: off | codex | claude */
  agentProviderId: AgentProviderId;
  /** Where quiz code runs: a registered sandbox runner id ('docker', 'off', …). */
  sandboxProviderId: string;
  quiz: QuizGenerationSettings;
  review: ReviewSettings;
};

export const DEFAULT_QUIZ_SETTINGS: QuizGenerationSettings = {
  mcqCount: 2,
  clozeCount: 1,
  openCount: 1,
  codeCount: 1,
  difficulty: 'medium',
  customRubric:
    'Score correctness and conceptual understanding. Give partial credit for mostly correct answers, and require the key ideas from the reference answer. Be concise and explain what is missing.',
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  retention: 0.9,
  newPerDay: 20,
  maxReviewsPerDay: 200,
  typeCloze: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  themePack: DEFAULT_THEME_PACK,
  brandLogo: 'triple-c',
  autosaveMs: 800,
  providerId: 'mock',
  openRouterModelId: 'deepseek/deepseek-v4-flash-0731',
  claudeModelId: 'sonnet',
  agentProviderId: 'off',
  sandboxProviderId: 'docker',
  quiz: { ...DEFAULT_QUIZ_SETTINGS },
  review: { ...DEFAULT_REVIEW_SETTINGS },
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
  return Math.max(0, Math.min(50, Math.round(n)));
}

export function resolveQuizSettings(value: unknown): QuizGenerationSettings {
  const raw =
    value && typeof value === 'object' ? (value as Partial<QuizGenerationSettings>) : {};
  const next: QuizGenerationSettings = {
    mcqCount: clampQuizCount(raw.mcqCount, DEFAULT_QUIZ_SETTINGS.mcqCount),
    clozeCount: clampQuizCount(raw.clozeCount, DEFAULT_QUIZ_SETTINGS.clozeCount),
    openCount: clampQuizCount(raw.openCount, DEFAULT_QUIZ_SETTINGS.openCount),
    codeCount: clampQuizCount(raw.codeCount, DEFAULT_QUIZ_SETTINGS.codeCount),
    difficulty: isQuizDifficulty(raw.difficulty)
      ? raw.difficulty
      : DEFAULT_QUIZ_SETTINGS.difficulty,
    customRubric:
      typeof raw.customRubric === 'string'
        ? raw.customRubric.slice(0, 500)
        : DEFAULT_QUIZ_SETTINGS.customRubric,
  };
  // Keep at least one question type enabled.
  if (next.mcqCount + next.clozeCount + next.openCount + next.codeCount === 0) {
    next.mcqCount = 1;
  }
  return next;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function resolveReviewSettings(value: unknown): ReviewSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<ReviewSettings>) : {};
  return {
    retention: Math.round(clampNumber(raw.retention, 0.7, 0.97, DEFAULT_REVIEW_SETTINGS.retention) * 100) / 100,
    newPerDay: Math.round(clampNumber(raw.newPerDay, 0, 9999, DEFAULT_REVIEW_SETTINGS.newPerDay)),
    maxReviewsPerDay: Math.round(clampNumber(raw.maxReviewsPerDay, 0, 99999, DEFAULT_REVIEW_SETTINGS.maxReviewsPerDay)),
    typeCloze: typeof raw.typeCloze === 'boolean' ? raw.typeCloze : DEFAULT_REVIEW_SETTINGS.typeCloze,
  };
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
