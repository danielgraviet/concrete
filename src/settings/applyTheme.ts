import type { ThemePackId } from './types';
import { DEFAULT_THEME_PACK, THEME_PACKS } from './types';

/**
 * Apply a theme pack as CSS custom properties on :root.
 * Variables: --mv-bg, --mv-surface, --mv-surface-2, --mv-text, --mv-muted,
 * --mv-accent, --mv-border, --mv-chrome
 */
export function applyTheme(
  packId: ThemePackId,
  root: HTMLElement = document.documentElement,
): void {
  const pack = THEME_PACKS[packId] ?? THEME_PACKS[DEFAULT_THEME_PACK];
  const { colors } = pack;
  root.style.setProperty('--mv-bg', colors.bg);
  root.style.setProperty('--mv-surface', colors.surface);
  root.style.setProperty('--mv-surface-2', colors.surface2);
  root.style.setProperty('--mv-text', colors.text);
  root.style.setProperty('--mv-muted', colors.muted);
  root.style.setProperty('--mv-accent', colors.accent);
  root.style.setProperty('--mv-border', colors.border);
  root.style.setProperty('--mv-chrome', colors.chrome);
  root.dataset.theme = pack.id;
}
