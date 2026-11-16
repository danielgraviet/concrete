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
import { cloudRootFor, createCloudVault, type CloudVault, type RecoveredCopy } from './cloudVault';
import { DEMO_USER, seedDemoWorkspace } from './demoSeed';
import { isFirebaseConfiguredInEnv } from './firebaseEnv';
import { getFilesClient } from './filesClient';
import { InMemoryFiles } from './memoryFiles';
import { setWebIdTokenSource } from './index';
import { browserJournalStorage, createWriteJournal, type JournalStorage } from './writeJournal';

export type WebSessionMode = 'firebase' | 'demo';

export type SaveErrorListener = (path: string, error: Error) => void;
export type RecoveredListener = (copies: RecoveredCopy[]) => void;

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
  /** Unsaved edits from a closed tab conflicted with newer remote notes and were saved as copies. */
  onRecovered(listener: RecoveredListener): () => void;
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
  /**
   * Write-ahead journal storage. Defaults to localStorage in Firebase mode and
   * none in demo mode (demo notes are reseeded on every load). Null disables it.
   */
  journalStorage?: JournalStorage | null;
}

let session: WebSession | null = null;

export function getWebSession(): WebSession | null {
  return session;
}

/** Vendor-free view of the current account, for features like sharing. */
export interface WebAccount {
  repo: CloudRepository;
  auth: AuthProvider;
  /** Signed-in user (uid = workspace id), or null. */
  user: CloudUser | null;
  /** Flush buffered vault writes so the repository has the latest content. */
  flush(): Promise<void>;
}

export function getWebAccount(): WebAccount | null {
  const current = session;
  if (!current) return null;
  return {
    repo: current.repo,
    auth: current.auth,
    user: current.auth.currentUser(),
    flush: async () => {
      await current.currentVault()?.flushAll();
    },
  };
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

  const journalStorage =
    options.journalStorage !== undefined ? options.journalStorage : mode === 'firebase' ? browserJournalStorage() : null;
  if (mode === 'firebase' && !journalStorage) {
    console.warn('[cloud] localStorage is unavailable; unsaved edits are lost if the tab closes before they sync.');
  }

  const saveErrorListeners = new Set<SaveErrorListener>();
  const recoveredListeners = new Set<RecoveredListener>();
  let unseenCopies: RecoveredCopy[] = [];
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
        journal: journalStorage ? createWriteJournal({ storage: journalStorage, uid }) : null,
        onRecovered: (copies) => {
          // Replay runs on open, possibly before the shell subscribed: hold the notice.
          if (!recoveredListeners.size) unseenCopies.push(...copies);
          for (const listener of [...recoveredListeners]) listener(copies);
        },
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
    onRecovered(listener) {
      recoveredListeners.add(listener);
      if (unseenCopies.length) {
        const copies = unseenCopies;
        unseenCopies = [];
        listener(copies);
      }
      return () => {
        recoveredListeners.delete(listener);
      };
    },
  };
  return session;
}

export { cloudRootFor };
