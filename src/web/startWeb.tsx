import { StrictMode, type ComponentType, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { AppTheme } from '../AppTheme';
import { initWebBackend } from '../backend/web/session';
import { AuthGate } from './AuthGate';

/** Web entry: set up the cloud backend, then render the app behind the auth gate. */
export async function startWeb(root: Root, App: ComponentType<{ accountSlot?: ReactNode }>): Promise<void> {
  const session = await initWebBackend();
  root.render(
    <StrictMode>
      <AppTheme>
        <AuthGate session={session}>{(account) => <App accountSlot={account} />}</AuthGate>
      </AppTheme>
    </StrictMode>,
  );
}
