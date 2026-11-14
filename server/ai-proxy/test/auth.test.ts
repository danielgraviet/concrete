import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, bearerToken, createFirebaseVerifier } from "../src/auth";

const PROJECT = "concrete-test";
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verify: ReturnType<typeof createFirebaseVerifier>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  verify = createFirebaseVerifier(PROJECT, createLocalJWKSet({ keys: [jwk] }), () => NOW);
});

function token(over: { iss?: string; aud?: string; sub?: string | null; iat?: number; exp?: number; kid?: string; key?: CryptoKey } = {}) {
  const claims: Record<string, unknown> = {};
  if (over.sub !== null) claims.sub = over.sub ?? "user-123";
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: over.kid ?? "k1" })
    .setIssuer(over.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(over.aud ?? PROJECT)
    .setIssuedAt(over.iat ?? nowSec - 60)
    .setExpirationTime(over.exp ?? nowSec + 3600)
    .sign(over.key ?? privateKey);
}

describe("createFirebaseVerifier", () => {
  it("accepts a valid token and returns uid = sub", async () => {
    expect(await verify(await token())).toEqual({ uid: "user-123" });
  });

  it.each([
    ["wrong audience", { aud: "other-project" }],
    ["wrong issuer", { iss: "https://securetoken.google.com/other-project" }],
    ["expired", { exp: nowSec - 3600, iat: nowSec - 7200 }],
    ["iat in the future", { iat: nowSec + 3600, exp: nowSec + 7200 }],
    ["empty sub", { sub: "" }],
    ["missing sub", { sub: null }],
    ["unknown kid", { kid: "nope" }],
  ])("rejects %s", async (_name, over) => {
    await expect(verify(await token(over as never))).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed by a different key", async () => {
    await expect(verify(await token({ key: otherKey }))).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects HS256 tokens", async () => {
    const hs = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough!!"));
    await expect(verify(hs)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects garbage", async () => {
    await expect(verify("not.a.jwt")).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects when the project id is not configured", async () => {
    const v = createFirebaseVerifier("", createLocalJWKSet({ keys: [] }), () => NOW);
    await expect(v(await token())).rejects.toBeInstanceOf(AuthError);
  });
});

describe("bearerToken", () => {
  const req = (h?: string) => new Request("https://x/", { headers: h ? { authorization: h } : {} });
  it("extracts the token", () => expect(bearerToken(req("Bearer abc.def"))).toBe("abc.def"));
  it("is case-insensitive on the scheme", () => expect(bearerToken(req("bearer abc"))).toBe("abc"));
  it("returns null when missing or malformed", () => {
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer "))).toBeNull();
  });
});
