import { describe, expect, it } from 'vitest';
import { FakeAuthProvider } from '../AuthProvider';
import { runCloudRepositoryContract } from '../contract';
import { decodeDataKey, encodeDataKey } from '../paths';
import { InMemoryCloudRepository } from './InMemoryCloudRepository';

runCloudRepositoryContract('InMemory', async () => ({
  repo: new InMemoryCloudRepository(),
  ws: 'user-a',
  otherWs: 'user-b',
}));

describe('encodeDataKey', () => {
  it('is reversible and safe as a Firestore document id', () => {
    for (const key of ['.vault/srs.json', '.vault/srs-log.jsonl', '__x__', '..', 'a b/ü~*']) {
      const encoded = encodeDataKey(key);
      expect(encoded).toMatch(/^[A-Za-z0-9%-]+$/);
      expect(decodeDataKey(encoded)).toBe(key);
    }
  });
});

describe('FakeAuthProvider', () => {
  it('signs in/out, notifies listeners and issues tokens', async () => {
    const auth = new FakeAuthProvider();
    const seen: Array<string | null> = [];
    const stop = auth.onChange((u) => seen.push(u?.uid ?? null));
    await Promise.resolve();
    expect(await auth.getIdToken()).toBeNull();
    const user = await auth.signInWithGoogle();
    expect(auth.currentUser()).toEqual(user);
    const token = await auth.getIdToken();
    expect(token).toContain(user.uid);
    expect(await auth.getIdToken(true)).not.toBe(token);
    await auth.signOut();
    stop();
    await auth.signInWithGoogle();
    expect(seen).toEqual([null, user.uid, null]);
  });
});
