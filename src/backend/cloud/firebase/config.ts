/**
 * Firebase app bootstrap. The ONLY place (with its siblings in this folder)
 * that touches the Firebase SDK — enforced by `../boundary.test.ts`.
 */

import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /** Point Auth + Firestore at the local emulators (`firebase emulators:start`). */
  useEmulator: boolean;
  /** `host:port`, defaults to 127.0.0.1:8080 / 127.0.0.1:9099 (see firebase.json). */
  firestoreEmulatorHost?: string;
  authEmulatorUrl?: string;
}

type EnvRecord = Record<string, string | boolean | undefined>;

function viteEnv(): EnvRecord {
  // `import.meta.env` is injected by Vite (and Vitest). Not typed here on
  // purpose so this module has no dependency on `vite/client` types.
  return ((import.meta as unknown as { env?: EnvRecord }).env ?? {}) as EnvRecord;
}

function str(env: EnvRecord, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads VITE_FIREBASE_* from the Vite env. */
export function readFirebaseConfig(env: EnvRecord = viteEnv()): FirebaseWebConfig {
  const flag = env.VITE_FIREBASE_USE_EMULATOR;
  return {
    apiKey: str(env, 'VITE_FIREBASE_API_KEY'),
    authDomain: str(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: str(env, 'VITE_FIREBASE_PROJECT_ID'),
    appId: str(env, 'VITE_FIREBASE_APP_ID'),
    useEmulator: flag === true || flag === 'true' || flag === '1',
  };
}

/** True when enough config is present to talk to a real project (or the emulator). */
export function isFirebaseConfigured(config: FirebaseWebConfig = readFirebaseConfig()): boolean {
  if (config.useEmulator) return Boolean(config.projectId);
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export interface FirebaseHandles {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
}

let handles: FirebaseHandles | null = null;

/**
 * Lazily initialize Firebase (once). Pass `config` to override the env, e.g.
 * in emulator tests. Throws when the config is incomplete.
 */
export function getFirebase(config: FirebaseWebConfig = readFirebaseConfig()): FirebaseHandles {
  if (handles) return handles;
  if (!isFirebaseConfigured(config)) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, ' +
        'VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID in .env (see src/backend/cloud/README.md).',
    );
  }
  const options: FirebaseOptions = {
    apiKey: config.apiKey || 'emulator-api-key',
    authDomain: config.authDomain || `${config.projectId}.firebaseapp.com`,
    projectId: config.projectId,
    appId: config.appId || 'emulator-app-id',
  };
  const app = getApps()[0] ?? initializeApp(options);
  const db = getFirestore(app);
  const auth = getAuth(app);
  if (config.useEmulator) {
    const [host, port] = (config.firestoreEmulatorHost ?? '127.0.0.1:8080').split(':');
    connectFirestoreEmulator(db, host, Number(port));
    connectAuthEmulator(auth, config.authEmulatorUrl ?? 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  handles = { app, db, auth };
  return handles;
}
