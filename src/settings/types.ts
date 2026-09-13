/** App settings — appearance driven by named theme packs + Radix Themes. */

import {
  DEFAULT_THEME_PACK,
  isThemePackId,
  type ThemePackId,
} from './themePacks';

export type { ThemePackId } from './themePacks';

/** @deprecated Prefer ThemePackId — kept for reading legacy localStorage. */
export type Appearance = 'dark' | 'light';

export type AppSettings = {
  themePack: ThemePackId;
  autosaveMs: number;
  providerId: string;
  /** OpenRouter model id when provider is openrouter. */
  openRouterModelId: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  themePack: DEFAULT_THEME_PACK,
  autosaveMs: 800,
  providerId: 'mock',
  openRouterModelId: 'deepseek/deepseek-v4-flash-0731',
};

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
