import type { ThemeProps } from '@radix-ui/themes';

/** Named visual packs — each sets Radix appearance + accent + chrome CSS. */
export type ThemePackId = 'concrete' | 'martian' | 'daytona';

export type ThemePack = {
  id: ThemePackId;
  label: string;
  description: string;
  appearance: NonNullable<ThemeProps['appearance']>;
  accentColor: NonNullable<ThemeProps['accentColor']>;
  grayColor: NonNullable<ThemeProps['grayColor']>;
  radius: NonNullable<ThemeProps['radius']>;
  /** Swatch preview colors: bg, accent, text */
  swatches: [string, string, string];
};

export const THEME_PACKS: ThemePack[] = [
  {
    id: 'concrete',
    label: 'Concrete',
    description: 'Light greyscale — soft nav, white writing surface',
    appearance: 'light',
    accentColor: 'gray',
    grayColor: 'gray',
    radius: 'medium',
    swatches: ['#f6f6f6', '#888888', '#ffffff'],
  },
  {
    id: 'martian',
    label: 'Martian',
    description: 'Light editorial with coral-orange accents',
    appearance: 'light',
    accentColor: 'orange',
    grayColor: 'gray',
    radius: 'large',
    // Coral from withmartian.com selection / brand orange
    swatches: ['#fafafa', '#FF563F', '#0c0c0c'],
  },
  {
    id: 'daytona',
    label: 'Daytona',
    description: 'Dark infra black with mint green + electric blue',
    appearance: 'dark',
    accentColor: 'teal',
    grayColor: 'gray',
    radius: 'medium',
    // Blacks / mint / blue from daytona.io
    swatches: ['#0a0a0a', '#00E49A', '#0080FF'],
  },
];

export const DEFAULT_THEME_PACK: ThemePackId = 'concrete';

export function isThemePackId(value: unknown): value is ThemePackId {
  return value === 'concrete' || value === 'martian' || value === 'daytona';
}

export function getThemePack(id: ThemePackId): ThemePack {
  return THEME_PACKS.find((pack) => pack.id === id) ?? THEME_PACKS[0];
}
