/**
 * Vendor-free mirror of `cloud/firebase/config.ts#isFirebaseConfigured`.
 * That module imports the Firebase SDK, so checking the env through it would
 * load Firebase just to decide whether to load Firebase.
 */

type EnvRecord = Record<string, string | boolean | undefined>;

function viteEnv(): EnvRecord {
  return ((import.meta as unknown as { env?: EnvRecord }).env ?? {}) as EnvRecord;
}

function str(env: EnvRecord, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Same rule as the Firebase config: emulator needs a project id; otherwise all four values. */
export function isFirebaseConfiguredInEnv(env: EnvRecord = viteEnv()): boolean {
  const flag = env.VITE_FIREBASE_USE_EMULATOR;
  if (flag === true || flag === 'true' || flag === '1') return Boolean(str(env, 'VITE_FIREBASE_PROJECT_ID'));
  return ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].every(
    (key) => Boolean(str(env, key)),
  );
}
