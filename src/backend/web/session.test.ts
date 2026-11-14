import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { FakeAuthProvider } from '../cloud/AuthProvider';
import type { Backend } from '../types';
import { getWebIdToken } from './index';
import { initWebBackend, resetWebSessionForTesting } from './session';
import { isFirebaseConfiguredInEnv } from './firebaseEnv';

function fakeBackend(): Backend {
  return {
    target: 'web',
    capabilities: {
      localAgents: false,
      revealInFolder: false,
      openWithOsApp: false,
      diskImport: false,
      nativePdfExport: false,
      localTelemetry: false,
      sandbox: false,
      apiKeySettings: false,
    },
  };
}

afterEach(() => resetWebSessionForTesting());

describe('initWebBackend', () => {
  it('uses the in-memory demo without loading Firebase when unconfigured', async () => {
    const loadFirebase = vi.fn();
    const backend = fakeBackend();
    const session = await initWebBackend({ firebaseConfigured: false, loadFirebase, backend });
    expect(loadFirebase).not.toHaveBeenCalled();
    expect(session.mode).toBe('demo');
    expect(session.repo).toBeInstanceOf(InMemoryCloudRepository);
    expect(session.auth.currentUser()?.uid).toBe('demo');
    expect(await getWebIdToken()).toMatch(/^fake-token:demo/);

    const vault = session.attachUser(session.auth.currentUser());
    expect(backend.vault).toBe(vault);
    const opened = await backend.vault!.restore();
    expect(opened?.root).toBe('cloud:demo');
    expect(opened?.files).toContain('Welcome.md');

    await session.signOut();
    expect(backend.vault).toBeUndefined();
    expect(session.auth.currentUser()).toBeNull();
    expect(await getWebIdToken()).toBeNull();
  });

  it('loads Firebase through the injected loader when configured', async () => {
    const repository = new InMemoryCloudRepository();
    const auth = new FakeAuthProvider(null);
    const loadFirebase = vi.fn(async () => ({ createFirebaseBackend: () => ({ repository, auth }) }));
    const session = await initWebBackend({ firebaseConfigured: true, loadFirebase, backend: fakeBackend() });
    expect(loadFirebase).toHaveBeenCalledTimes(1);
    expect(session.mode).toBe('firebase');
    expect(session.repo).toBe(repository);
  });

  it('flushes buffered writes before signing out', async () => {
    const backend = fakeBackend();
    const session = await initWebBackend({ firebaseConfigured: false, backend });
    session.attachUser(session.auth.currentUser());
    await backend.vault!.write('cloud:demo', 'Draft.md', 'unsaved');
    await session.signOut();
    expect(await session.repo.readNote('demo', 'Draft.md')).toBe('unsaved');
  });

  it('reads the Firebase env without the SDK', () => {
    expect(isFirebaseConfiguredInEnv({})).toBe(false);
    expect(isFirebaseConfiguredInEnv({ VITE_FIREBASE_USE_EMULATOR: 'true', VITE_FIREBASE_PROJECT_ID: 'demo' })).toBe(true);
    expect(
      isFirebaseConfiguredInEnv({
        VITE_FIREBASE_API_KEY: 'k',
        VITE_FIREBASE_AUTH_DOMAIN: 'd',
        VITE_FIREBASE_PROJECT_ID: 'p',
        VITE_FIREBASE_APP_ID: 'a',
      }),
    ).toBe(true);
  });
});
