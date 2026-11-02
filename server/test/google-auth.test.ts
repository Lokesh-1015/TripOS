// Checking Google's signed tokens with a real signature, using a key made here in place of Google's.
import type { ConfigService } from "@nestjs/config";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GoogleAuthService } from "../src/auth/google-auth.service.js";

const CLIENT_ID = "client-123.apps.googleusercontent.com";
const config = (env: Record<string, string>) => ({ get: (key: string) => env[key] }) as unknown as ConfigService;
const claims = { sub: "google-1", email: "friend@gmail.com", email_verified: true, name: "A Friend", picture: "https://example.org/me.png" };

describe("GoogleAuthService", () => {
  let service: GoogleAuthService;
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;

  const sign = (over: { key?: CryptoKey; issuer?: string; audience?: string; expires?: string; claims?: object } = {}) =>
    new SignJWT({ ...claims, ...over.claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuedAt()
      .setIssuer(over.issuer ?? "https://accounts.google.com")
      .setAudience(over.audience ?? CLIENT_ID)
      .setExpirationTime(over.expires ?? "1h")
      .sign(over.key ?? privateKey);

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256", use: "sig" };
    service = new GoogleAuthService(config({ GOOGLE_CLIENT_ID: CLIENT_ID }));
    service.keys = createLocalJWKSet({ keys: [jwk] });
  });

  it("accepts a token signed by Google for this app", async () => {
    await expect(service.verify(await sign())).resolves.toEqual({ sub: "google-1", email: "friend@gmail.com", emailVerified: true, name: "A Friend", picture: "https://example.org/me.png" });
  });

  it("accepts Google's other issuer spelling", async () => {
    await expect(service.verify(await sign({ issuer: "accounts.google.com" }))).resolves.toMatchObject({ sub: "google-1" });
  });

  it("reports whether Google has confirmed the address", async () => {
    await expect(service.verify(await sign({ claims: { email_verified: false } }))).resolves.toMatchObject({ emailVerified: false });
  });

  it.each([
    ["signed by someone else", () => ({ key: otherKey })],
    ["meant for another app", () => ({ audience: "someone-elses-app" })],
    ["from another issuer", () => ({ issuer: "https://evil.example" })],
    ["expired", () => ({ expires: "-1h" })],
  ])("refuses a token %s", async (_, over) => {
    await expect(service.verify(await sign(over()))).rejects.toMatchObject({ status: 401 });
  });

  it("refuses something that isn't a token at all", async () => {
    await expect(service.verify("not-a-token")).rejects.toMatchObject({ status: 401 });
  });

  it("says it's unavailable when Google's keys can't be reached, rather than blaming the person", async () => {
    const offline = new GoogleAuthService(config({ GOOGLE_CLIENT_ID: CLIENT_ID }));
    offline.keys = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn((offline as unknown as { logger: { error: () => void } }).logger, "error").mockImplementation(() => undefined);
    await expect(offline.verify(await sign())).rejects.toMatchObject({ status: 503 });
  });

  describe("test tokens", () => {
    const testToken = `test-google.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;

    it("are never accepted in production, even if the setting is on", async () => {
      const production = new GoogleAuthService(config({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_TEST_TOKENS: "true", NODE_ENV: "production" }));
      await expect(production.verify(testToken)).rejects.toMatchObject({ status: 401 });
    });

    it("are refused unless the setting is on", async () => {
      await expect(service.verify(testToken)).rejects.toMatchObject({ status: 401 });
    });

    it("work in tests when it is", async () => {
      await expect(new GoogleAuthService(config({ GOOGLE_TEST_TOKENS: "true" })).verify(testToken)).resolves.toMatchObject({ sub: "google-1" });
    });
  });

  it("is off with no client id set", () => {
    expect(new GoogleAuthService(config({})).enabled).toBe(false);
  });
});
