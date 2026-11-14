import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, Callout, DropdownMenu, Flex, Spinner, Text } from '@radix-ui/themes';
import { BrandLogo } from '../branding/BrandLogo';
import { settingsStore } from '../settings';
import type { CloudUser } from '../backend/cloud/AuthProvider';
import type { WebSession } from '../backend/web/session';
import { runPageExitFlushes } from '../editor/pageExitFlush';
import './web.css';

const MySharesDialog = lazy(() => import('./share/MySharesDialog').then((m) => ({ default: m.MySharesDialog })));

type AuthState = { status: 'restoring' } | { status: 'signed-out' } | { status: 'signed-in'; user: CloudUser };

function initials(user: CloudUser): string {
  const source = user.displayName?.trim() || user.email?.trim() || '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/popup-closed|cancelled-popup/.test(code)) return 'Sign-in was cancelled.';
  if (/popup-blocked/.test(code)) return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
  if (/network/.test(code)) return 'Network error. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Could not sign in.';
}

/**
 * Web-only gate: sign-in screen while signed out, a quiet loader while the
 * persisted session restores, and the app (with a cloud vault mounted for
 * the user) once signed in. `children` receives the account control to place
 * in the app chrome.
 */
export function AuthGate({
  session,
  children,
}: {
  session: WebSession;
  children: (account: ReactNode) => ReactNode;
}) {
  const [state, setState] = useState<AuthState>(() => {
    const user = session.auth.currentUser();
    if (user) session.attachUser(user);
    return user ? { status: 'signed-in', user } : { status: 'restoring' };
  });
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      session.auth.onChange((user) => {
        session.attachUser(user);
        setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      }),
    [session],
  );

  useEffect(() => session.onSaveError((path, err) => setSaveError(`Could not save "${path}": ${err.message}`)), [session]);

  useEffect(
    () =>
      session.onRecovered((copies) => {
        const names = copies.map((c) => `"${c.copyPath}"`).join(', ');
        setNotice(
          copies.length === 1
            ? `"${copies[0].path}" was changed elsewhere after your last unsaved edit, so that edit was saved as ${names}.`
            : `Some notes were changed elsewhere after your last unsaved edits, so those edits were saved as ${names}.`,
        );
      }),
    [session],
  );

  // Buffered writes are journaled to localStorage and replayed on the next
  // visit, so only warn before closing when something could not be journaled
  // (no localStorage, quota full, entry too large).
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      runPageExitFlushes(); // pending editor autosave → vault (journaled) first
      if (!session.currentVault()?.hasUnjournaledWrites()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await session.auth.signInWithGoogle();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSigningIn(false);
    }
  };

  if (state.status === 'restoring') {
    return (
      <div className="web-auth-screen" aria-busy="true">
        <Spinner size="3" />
      </div>
    );
  }

  if (state.status === 'signed-out') {
    return (
      <div className="web-auth-screen">
        <div className="web-auth-card">
          <BrandLogo logo={settingsStore.get().brandLogo} className="web-auth-logo" />
          <Text as="p" size="3" color="gray" align="center">
            Markdown notes that turn into flashcards and quizzes you actually review.
          </Text>
          <Button size="3" onClick={() => void signIn()} disabled={signingIn}>
            {signingIn ? <Spinner /> : null}
            Continue with Google
          </Button>
          {session.mode === 'demo' ? (
            <Text as="p" size="1" color="gray" align="center">
              Local demo: Firebase is not configured, so sign-in uses a demo account and notes stay in memory.
            </Text>
          ) : null}
          {error ? (
            <Callout.Root color="red" size="1" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </div>
      </div>
    );
  }

  const account = <AccountMenu user={state.user} session={session} />;
  return (
    <>
      {saveError ? (
        <div className="web-save-error" role="alert">
          <span>{saveError}</span>
          <button type="button" onClick={() => setSaveError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {notice && !saveError ? (
        <div className="web-save-error web-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {/* Remount the app per user so no state leaks between accounts. */}
      <div key={state.user.uid} style={{ display: 'contents' }}>
        {children(account)}
      </div>
    </>
  );
}

function AccountMenu({ user, session }: { user: CloudUser; session: WebSession }) {
  const [busy, setBusy] = useState(false);
  const [sharesOpen, setSharesOpen] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await session.signOut();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not sign out.');
      setBusy(false);
    }
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button type="button" className="web-account-trigger" aria-label="Account" disabled={busy}>
            <Avatar
              size="1"
              radius="full"
              src={user.photoURL ?? undefined}
              fallback={initials(user)}
              className="web-account-avatar"
            />
            <span>{user.displayName || user.email || 'Account'}</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content size="1" align="end">
          {user.email ? (
            <DropdownMenu.Label>
              <Flex direction="column">
                <Text size="1" color="gray">
                  {user.email}
                </Text>
              </Flex>
            </DropdownMenu.Label>
          ) : null}
          <DropdownMenu.Item onSelect={() => setSharesOpen(true)}>My shares</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => void signOut()}>Sign out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {sharesOpen ? (
        <Suspense fallback={null}>
          <MySharesDialog open={sharesOpen} onOpenChange={setSharesOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
