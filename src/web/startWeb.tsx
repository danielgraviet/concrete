import { StrictMode, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { AppTheme } from '../AppTheme';
import { initWebBackend } from '../backend/web/session';
import { AuthGate } from './AuthGate';
import { parseShareRoute } from './share/route';
import { createShareController } from './share/shareController';
import type { RequestShare } from './share/types';

const ShareViewer = lazy(() => import('./share/ShareViewer').then((m) => ({ default: m.ShareViewer })));
const ShareDialogHost = lazy(() => import('./share/ShareDialog').then((m) => ({ default: m.ShareDialogHost })));

export type WebAppProps = { accountSlot?: ReactNode; onShare?: RequestShare };

/** Web entry: set up the cloud backend, then render the app behind the auth gate. */
export async function startWeb(root: Root, App: ComponentType<WebAppProps>): Promise<void> {
  const session = await initWebBackend();

  // Public share links render without the sign-in gate.
  const shareId = parseShareRoute(window.location.pathname);
  if (shareId) {
    root.render(
      <StrictMode>
        <AppTheme>
          <Suspense fallback={null}>
            <ShareViewer shareId={shareId} session={session} />
          </Suspense>
        </AppTheme>
      </StrictMode>,
    );
    return;
  }

  const shares = createShareController();
  root.render(
    <StrictMode>
      <AppTheme>
        <AuthGate session={session}>
          {(account) => (
            <>
              <App accountSlot={account} onShare={shares.open} />
              <Suspense fallback={null}>
                <ShareDialogHost controller={shares} />
              </Suspense>
            </>
          )}
        </AuthGate>
      </AppTheme>
    </StrictMode>,
  );
}
