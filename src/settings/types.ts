/** App settings + named theme packs. */

export type ThemePackId = 'vault-dark' | 'paper-light' | 'forest';

/** Full color set applied when a pack is selected. */
export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  chrome: string;
};

export type ThemePack = {
  id: ThemePackId;
  name: string;
  description: string;
  colors: ThemeColors;
};

export const THEME_PACKS: Record<ThemePackId, ThemePack> = {
  'vault-dark': {
    id: 'vault-dark',
    name: 'Vault Dark',
    description: 'Obsidian-like charcoal',
    colors: {
      bg: '#191919',
      surface: '#202020',
      surface2: '#292929',
      text: '#d6d6d6',
      muted: '#777777',
      accent: '#8c9eff',
      border: '#303030',
      chrome: '#1d1d1d',
    },
  },
  'paper-light': {
    id: 'paper-light',
    name: 'Paper Light',
    description: 'Clean daylight paper',
    colors: {
      bg: '#f0f2f4',
      surface: '#f7f8fa',
      surface2: '#ffffff',
      text: '#1e2329',
      muted: '#6b7280',
      accent: '#3d6b99',
      border: '#d5dae0',
      chrome: '#e8ebef',
    },
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green night',
    colors: {
      bg: '#121a14',
      surface: '#1a2420',
      surface2: '#24302a',
      text: '#d4e0d6',
      muted: '#6e8575',
      accent: '#7dba8a',
      border: '#2a3830',
      chrome: '#15201a',
    },
  },
};

export const THEME_PACK_LIST: ThemePack[] = [
  THEME_PACKS['vault-dark'],
  THEME_PACKS['paper-light'],
  THEME_PACKS.forest,
];

export const DEFAULT_THEME_PACK: ThemePackId = 'vault-dark';

/** @deprecated Prefer THEME_PACKS[DEFAULT_THEME_PACK].colors */
export const DEFAULT_THEME: ThemeColors = { ...THEME_PACKS[DEFAULT_THEME_PACK].colors };

export type AppSettings = {
  /** Named theme pack id only. */
  theme: ThemePackId;
  autosaveMs: number;
  providerId: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_PACK,
  autosaveMs: 800,
  providerId: 'mock',
};

export function isThemePackId(value: unknown): value is ThemePackId {
  return typeof value === 'string' && value in THEME_PACKS;
}
