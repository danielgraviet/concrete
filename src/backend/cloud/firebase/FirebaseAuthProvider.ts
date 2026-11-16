/** Firebase Auth implementation of the vendor-neutral AuthProvider. */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { AuthProvider, CloudUser } from '../AuthProvider';
import { PermissionError } from '../errors';

function toCloudUser(user: User | null): CloudUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

export class FirebaseAuthProvider implements AuthProvider {
  constructor(private readonly auth: Auth) {}

  currentUser(): CloudUser | null {
    return toCloudUser(this.auth.currentUser);
  }

  onChange(cb: (user: CloudUser | null) => void): () => void {
    // Fires once the persisted session is restored, then on every change.
    return onAuthStateChanged(this.auth, (user) => cb(toCloudUser(user)));
  }

  async signInWithGoogle(): Promise<CloudUser> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const credential = await signInWithPopup(this.auth, provider);
      return toCloudUser(credential.user)!;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw new PermissionError('Sign-in was cancelled');
      }
      throw error;
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    const user = this.auth.currentUser;
    return user ? user.getIdToken(forceRefresh) : null;
  }
}
