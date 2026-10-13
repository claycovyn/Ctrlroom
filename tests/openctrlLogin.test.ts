// "Continue with OpenCtrl": ID token checks, which account to use, signed cookies, and the token exchange against a
// fake OpenCtrl. The Supabase side (openctrlBridge.ts) is covered by supabase/tests/17_openctrl_signin.test.sql.
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const oc = await import("@/lib/openctrlLogin");

const ISS = "https://openctrl.test";
const CLIENT = "oc_ctrlroom";
const SECRET = "client-secret-for-tests";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string }), kid: "k1", alg: "RS256" };

function jwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "k1" }, key = privateKey) {
  const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b(header)}.${b(payload)}`;
  return `${input}.${crypto.createSign("RSA-SHA256").update(input).sign(key).toString("base64url")}`;
}
const now = Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({ iss: ISS, aud: CLIENT, sub: "user_1", iat: now, exp: now + 600, nonce: "n1", email: "ada@example.com", email_verified: true, ...over });
const expectOk = { issuer: ISS, clientId: CLIENT, nonce: "n1" };

describe("ID token", () => {
  it("accepts a token OpenCtrl signed for this app", () => {
    expect(oc.verifyIdToken(jwt(claims()), jwk, expectOk)).toMatchObject({ sub: "user_1" });
  });
  it("refuses another issuer, app, nonce, expired, algorithm or signature", () => {
    const bad: [string, RegExp][] = [
      [jwt(claims({ iss: "https://evil.test" })), /another issuer/],
      [jwt(claims({ aud: "oc_other" })), /another app/],
      [jwt(claims({ nonce: "x" })), /nonce/],
      [jwt(claims({ exp: now - 120 })), /expired/],
      [jwt(claims(), { alg: "none", kid: "k1" }), /algorithm/],
      [jwt(claims(), undefined, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey), /signature/],
    ];
    for (const [t, why] of bad) expect(() => oc.verifyIdToken(t, jwk, expectOk)).toThrow(why);
  });
});

describe("which account", () => {
  const v = { sub: "s1", email: "ada@example.com", email_verified: true };
  it("signs in the linked account first", () => {
    expect(oc.decideLogin(v, "u-linked", { id: "u-email", emailConfirmedAt: "x" }, null)).toEqual({ kind: "login", userId: "u-linked" });
  });
  it("connects the account you're signed in to, unless it's linked elsewhere", () => {
    expect(oc.decideLogin(v, null, null, { id: "u-cur" })).toEqual({ kind: "link", userId: "u-cur" });
    expect(oc.decideLogin(v, null, null, { id: "u-cur", linkedSub: "other" })).toEqual({ kind: "error", code: "taken" });
  });
  it("links by email only when both sides confirmed it", () => {
    expect(oc.decideLogin(v, null, { id: "u", emailConfirmedAt: "2026-10-01" }, null)).toEqual({ kind: "link", userId: "u" });
    expect(oc.decideLogin(v, null, { id: "u", emailConfirmedAt: null }, null)).toEqual({ kind: "confirm-password", email: "ada@example.com" });
    expect(oc.decideLogin({ ...v, email_verified: false }, null, { id: "u", emailConfirmedAt: "2026-10-01" }, null).kind).toBe("confirm-password");
    expect(oc.decideLogin(v, null, { id: "u", emailConfirmedAt: "x", linkedSub: "other" }, null)).toEqual({ kind: "error", code: "taken" });
  });
  it("creates an account only for an email OpenCtrl confirmed", () => {
    expect(oc.decideLogin(v, null, null, null)).toEqual({ kind: "create" });
    expect(oc.decideLogin({ ...v, email_verified: false }, null, null, null)).toEqual({ kind: "error", code: "unverified" });
    expect(oc.decideLogin({ sub: "s1" }, null, null, null)).toEqual({ kind: "error", code: "noemail" });
  });
});

describe("signed cookies", () => {
  it("round-trip, and reject tampering, another purpose, another secret and expiry", () => {
    const c = oc.sealCookie(SECRET, "oc-state", { state: "abc" }, 600);
    expect(oc.openCookie<{ state: string }>(SECRET, "oc-state", c)?.state).toBe("abc");
    expect(oc.openCookie(SECRET, "oc-link", c)).toBeNull();
    expect(oc.openCookie("another-secret", "oc-state", c)).toBeNull();
    const [, sig] = c.split(".");
    expect(oc.openCookie(SECRET, "oc-state", `${Buffer.from(JSON.stringify({ state: "evil", exp: now + 600 })).toString("base64url")}.${sig}`)).toBeNull();
    expect(oc.openCookie(SECRET, "oc-state", c, Date.now() + 601_000)).toBeNull();
  });
});

describe("token exchange", () => {
  it("keeps where to go next, sends the secret and PKCE verifier, and verifies what comes back", async () => {
    const config = { issuer: ISS, clientId: CLIENT, clientSecret: SECRET };
    const start = oc.startLogin(config, `${ISS}/oauth/authorize`, "https://room.test/auth/openctrl/callback", "/c/devs");
    const pending = oc.openCookie<{ state: string; nonce: string; verifier: string; next: string }>(SECRET, "oc-state", start.cookie)!;
    expect(pending.next).toBe("/c/devs");
    const u = new URL(start.url);
    expect(u.searchParams.get("state")).toBe(pending.state);
    expect(u.searchParams.get("code_challenge")).toBe(crypto.createHash("sha256").update(pending.verifier).digest("base64url"));

    let sent: URLSearchParams | undefined;
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth/token`, jwks_uri: `${ISS}/oauth/jwks` });
      if (url.endsWith("/oauth/jwks")) return Response.json({ keys: [jwk] });
      if (url.endsWith("/oauth/token")) {
        sent = new URLSearchParams(String(init?.body));
        return Response.json({ id_token: jwt(claims({ nonce: pending.nonce })) });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    expect(await oc.finishLogin(config, pending, "c0de", "https://room.test/auth/openctrl/callback", fake)).toMatchObject({ sub: "user_1" });
    expect(sent?.get("code_verifier")).toBe(pending.verifier);
  });
});
