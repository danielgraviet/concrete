import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface AuthedUser {
  uid: string;
}

export type TokenVerifier = (token: string) => Promise<AuthedUser>;

export class AuthError extends Error {}

// Module scope so the key set is cached across requests within an isolate.
let remoteJwks: JWTVerifyGetKey | undefined;
function defaultJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  return remoteJwks;
}

const CLOCK_TOLERANCE_SEC = 60;

/**
 * Verifies a Firebase ID token (RS256, Google securetoken keys) without firebase-admin.
 * `getKey` is injectable so tests can use a local key set.
 */
export function createFirebaseVerifier(
  projectId: string,
  getKey: JWTVerifyGetKey = defaultJwks(),
  now: () => number = () => Date.now(),
): TokenVerifier {
  return async (token: string) => {
    if (!projectId) throw new AuthError("FIREBASE_PROJECT_ID not configured");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, getKey, {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        clockTolerance: CLOCK_TOLERANCE_SEC,
        currentDate: new Date(now()),
        requiredClaims: ["exp", "iat", "sub"],
      }));
    } catch (err) {
      throw new AuthError(err instanceof Error ? err.message : "invalid token");
    }
    const nowSec = Math.floor(now() / 1000);
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthError("missing sub");
    }
    if (typeof payload.iat !== "number" || payload.iat > nowSec + CLOCK_TOLERANCE_SEC) {
      throw new AuthError("iat in the future");
    }
    return { uid: payload.sub };
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}
