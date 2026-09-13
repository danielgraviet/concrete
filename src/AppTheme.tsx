import { useEffect, useState } from 'react';
import { Theme } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import {
  getThemePack,
  settingsStore,
  type ThemePackId,
} from './settings';

type Props = {
  children: ReactNode;
};

/**
 * Root Radix Themes wrapper — pack from settings (Default / Martian / …).
 * @see https://www.radix-ui.com/themes/docs/overview/getting-started
 */
export function AppTheme({ children }: Props) {
  const [packId, setPackId] = useState<ThemePackId>(
    () => settingsStore.hydrate().themePack,
  );

  useEffect(() => {
    return settingsStore.subscribe((next) => setPackId(next.themePack));
  }, []);

  const pack = getThemePack(packId);

  return (
    <Theme
      appearance={pack.appearance}
      accentColor={pack.accentColor}
      grayColor={pack.grayColor}
      radius={pack.radius}
      scaling="95%"
      panelBackground="solid"
      className={`theme-pack theme-pack-${pack.id}`}
      data-theme-pack={pack.id}
    >
      {children}
    </Theme>
  );
}
