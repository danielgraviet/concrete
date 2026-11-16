/**
 * Runs the shared contract against the Firestore + Auth emulators, with the
 * real security rules. Skipped unless the emulators are running:
 *
 *   firebase emulators:exec --only firestore,auth --project demo-concrete \
 *     "npx vitest run src/backend/cloud/firebase"
 *
 * (`emulators:exec` sets FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST.)
 */

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, terminate } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { runCloudRepositoryContract } from '../contract';
import { PermissionError } from '../errors';
import { FirebaseCloudRepository } from './FirebaseCloudRepository';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const firestoreHost = env.FIRESTORE_EMULATOR_HOST;
const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = env.GCLOUD_PROJECT || 'demo-concrete';

let appCounter = 0;

async function makeHarness() {
  appCounter += 1;
  const app = initializeApp({ apiKey: 'demo-key', projectId, appId: 'demo-app' }, `contract-${appCounter}`);
  const db = getFirestore(app);
  const [host, port] = firestoreHost!.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  // A fresh anonymous user per test = a fresh, empty workspace.
  const { user } = await signInAnonymously(auth);
  return {
    repo: new FirebaseCloudRepository(db),
    ws: user.uid,
    foreignWs: `not-${user.uid}`,
    watchSettleMs: 300,
    cleanup: async () => {
      await terminate(db);
      await deleteApp(app);
    },
  };
}

if (firestoreHost && authHost) {
  runCloudRepositoryContract('Firebase (emulator)', makeHarness, 60_000);

  describe('Firestore security rules (emulator)', () => {
    it('enforces share ownership and workspace privacy', async () => {
      const alice = await makeHarness();
      const bob = await makeHarness();
      try {
        // Creating a share in someone else's name is rejected by the rules.
        await expect(
          alice.repo.createShare(bob.ws, { kind: 'note', title: 'spoof', payload: 'x' }),
        ).rejects.toBeInstanceOf(PermissionError);

        const { shareId } = await alice.repo.createShare(alice.ws, { kind: 'note', title: 'hi', payload: 'x' });
        // Anyone can read it by id...
        expect(await bob.repo.getShare(shareId)).toMatchObject({ title: 'hi', ownerWs: alice.ws });
        // ...but only the owner can delete or list it.
        await expect(bob.repo.deleteShare(bob.ws, shareId)).rejects.toBeInstanceOf(PermissionError);
        await expect(bob.repo.listMyShares(alice.ws)).rejects.toBeInstanceOf(PermissionError);
        expect(await bob.repo.listMyShares(bob.ws)).toEqual([]);
        // Bob cannot reach Alice's private workspace.
        await alice.repo.writeNote(alice.ws, 'Secret.md', 'shh');
        await expect(bob.repo.readNote(alice.ws, 'Secret.md')).rejects.toBeInstanceOf(PermissionError);
      } finally {
        await alice.cleanup();
        await bob.cleanup();
      }
    }, 60_000);
  });
} else {
  describe('CloudRepository contract: Firebase (emulator)', () => {
    it.skip('requires FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST', () => {});
  });
}
