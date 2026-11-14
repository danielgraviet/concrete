/**
 * Web session bootstrap: picks the cloud backend (Firebase when configured,
 * otherwise an in-memory demo), wires auth into the AI proxy, and mounts a
 * cloud vault on `getBackend().vault` for the signed-in user.
 *
 * Only `src/main.tsx` (web target) and `src/web/` import this module, so the
 * dynamic Firebase import below never reaches the desktop bundle.
 */

import { getBackend } from '../index';
import type { Backend } from '../types';
import { FakeAuthProvider, type AuthProvider, type CloudUser } from '../cloud/AuthProvider';
import type { CloudRepository } from '../cloud/CloudRepository';
import { InMemoryCloudRepository } from '../cloud/memory/InMemoryCloudRepository';
import { cloudRootFor, createCloudVault, type CloudVault } from './cloudVault';
import { DEMO_USER, seedDemoWorkspace } from './demoSeed';
import { isFirebaseConfiguredInEnv } from './firebaseEnv';
import { getFilesClient } from './filesClient';
import { InMemoryFiles } from './memoryFiles';
import { setWebIdTokenSource } from './index';

export type WebSessionMode = 'firebase' | 'demo';

export type SaveErrorListener = (path: string, error: Error) => void;

export interface WebSession {
  mode: WebSessionMode;
  auth: AuthProvider;
  repo: CloudRepository;
  /** Mount (or unmount, for null) the cloud vault for `user`. Idempotent per uid. */
  attachUser(user: CloudUser | null): CloudVault | null;
  currentVault(): CloudVault | null;
  /** Flush buffered writes, then sign out and unmount the vault. */
  signOut(): Promise<void>;
  onSaveError(listener: SaveErrorListener): () => void;
}

type FirebaseModule = {
  createFirebaseBackend: () => { repository: CloudRepository; auth: AuthProvider };
};

export interface InitWebBackendOptions {
  /** Defaults to the VITE_FIREBASE_* env check. */
  firebaseConfigured?: boolean;
  /** Defaults to `import('../cloud/firebase')`; injectable for tests. */
  loadFirebase?: () => Promise<FirebaseModule>;
  /** Defaults to `getBackend()`. */
  backend?: Backend;
}

let session: WebSession | null = null;

export function getWebSession(): WebSession | null {
  return session;
}

/** Reset for tests. */
export function resetWebSessionForTesting(): void {
  session?.currentVault()?.dispose();
  session = null;
  setWebIdTokenSource(null);
}

export async function initWebBackend(options: InitWebBackendOptions = {}): Promise<WebSession> {
  if (session) return session;
  const backend = options.backend ?? getBackend();
  const configured = options.firebaseConfigured ?? isFirebaseConfiguredInEnv();

  let mode: WebSessionMode;
  let repo: CloudRepository;
  let auth: AuthProvider;
  if (configured) {
    const load = options.loadFirebase ?? (() => import('../cloud/firebase') as Promise<FirebaseModule>);
    const { createFirebaseBackend } = await load();
    const created = createFirebaseBackend();
    mode = 'firebase';
    repo = created.repository;
    auth = created.auth;
  } else {
    const memory = new InMemoryCloudRepository();
    await seedDemoWorkspace(memory, DEMO_USER.uid);
    mode = 'demo';
    repo = memory;
    auth = new FakeAuthProvider(DEMO_USER, DEMO_USER);
  }

  setWebIdTokenSource(() => auth.getIdToken());
  // Images/PDFs: R2 via the proxy Worker when signed in to Firebase (none when
  // VITE_AI_PROXY_URL is unset); an in-memory store in demo mode.
  const files = mode === 'firebase' ? getFilesClient() ?? undefined : new InMemoryFiles();

  const saveErrorListeners = new Set<SaveErrorListener>();
  let vault: CloudVault | null = null;
  let vaultUid: string | null = null;

  const detach = () => {
    vault?.dispose();
    vault = null;
    vaultUid = null;
    backend.vault = undefined;
  };

  session = {
    mode,
    auth,
    repo,
    attachUser(user) {
      if (!user) {
        detach();
        return null;
      }
      if (vault && vaultUid === user.uid) return vault;
      detach();
      const uid = user.uid;
      vault = createCloudVault({
        repo,
        getWorkspaceId: () => uid,
        files,
        onSaveError: (path, error) => {
          if (!saveErrorListeners.size) console.warn(`[cloud] could not save "${path}"`, error);
          for (const listener of [...saveErrorListeners]) listener(path, error);
        },
      });
      vaultUid = uid;
      backend.vault = vault;
      return vault;
    },
    currentVault: () => vault,
    async signOut() {
      await vault?.flushAll();
      // Sign out first: the auth listener unmounts the app, so nothing calls
      // the vault after it is detached.
      await auth.signOut();
      detach();
    },
    onSaveError(listener) {
      saveErrorListeners.add(listener);
      return () => {
        saveErrorListeners.delete(listener);
      };
    },
  };
  return session;
}

export { cloudRootFor };
