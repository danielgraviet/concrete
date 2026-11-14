/**
 * Auth contract for the web version. Vendor-free, like CloudRepository:
 * Firebase Auth is one implementation (`firebase/FirebaseAuthProvider`).
 */

export interface CloudUser {
  /** Stable user id; also the workspace id passed to CloudRepository. */
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface AuthProvider {
  /** Synchronous snapshot; null when signed out or not yet restored (see onChange). */
  currentUser(): CloudUser | null;

  /**
   * Called with the current user once auth state is known (after a persisted
   * session is restored) and again on every sign-in/sign-out.
   */
  onChange(cb: (user: CloudUser | null) => void): () => void;

  signInWithGoogle(): Promise<CloudUser>;

  signOut(): Promise<void>;

  /**
   * Bearer token for our own servers (the AI proxy verifies it). Null when
   * signed out. Tokens last ~1 hour; implementations refresh automatically,
   * `forceRefresh` forces a new one (e.g. after a 401).
   */
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
}

/** Deterministic AuthProvider for tests and the signed-out demo. */
export class FakeAuthProvider implements AuthProvider {
  private user: CloudUser | null;
  private readonly listeners = new Set<(user: CloudUser | null) => void>();
  private tokenVersion = 0;

  constructor(
    initialUser: CloudUser | null = null,
    private readonly googleUser: CloudUser = {
      uid: 'fake-user',
      email: 'fake@example.com',
      displayName: 'Fake User',
      photoURL: null,
    },
  ) {
    this.user = initialUser;
  }

  currentUser(): CloudUser | null {
    return this.user;
  }

  onChange(cb: (user: CloudUser | null) => void): () => void {
    this.listeners.add(cb);
    queueMicrotask(() => {
      if (this.listeners.has(cb)) cb(this.user);
    });
    return () => {
      this.listeners.delete(cb);
    };
  }

  async signInWithGoogle(): Promise<CloudUser> {
    this.setUser(this.googleUser);
    return this.googleUser;
  }

  async signOut(): Promise<void> {
    this.setUser(null);
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    if (!this.user) return null;
    if (forceRefresh) this.tokenVersion += 1;
    return `fake-token:${this.user.uid}:${this.tokenVersion}`;
  }

  /** Test helper: switch user and notify listeners. */
  setUser(user: CloudUser | null): void {
    this.user = user;
    for (const cb of [...this.listeners]) cb(user);
  }
}
