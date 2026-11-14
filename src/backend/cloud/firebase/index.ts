/**
 * Firebase wiring. Import this lazily (`await import('./backend/cloud/firebase')`)
 * so the Firebase SDK stays out of bundles that never sign in.
 */

import { FirebaseAuthProvider } from './FirebaseAuthProvider';
import { FirebaseCloudRepository } from './FirebaseCloudRepository';
import { getFirebase, type FirebaseWebConfig } from './config';

export { FirebaseAuthProvider } from './FirebaseAuthProvider';
export { FirebaseCloudRepository } from './FirebaseCloudRepository';
export { getFirebase, isFirebaseConfigured, readFirebaseConfig, type FirebaseWebConfig } from './config';

/** One-call setup: repository + auth provider over the env-configured project. */
export function createFirebaseBackend(config?: FirebaseWebConfig) {
  const { db, auth } = getFirebase(config);
  return {
    repository: new FirebaseCloudRepository(db),
    auth: new FirebaseAuthProvider(auth),
  };
}
