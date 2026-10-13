// "Continue with OpenCtrl": Ctrl Room signs people in with their OpenCtrl account (OpenID Connect, authorization code
// flow with PKCE). Off unless OPENCTRL_CLIENT_ID and OPENCTRL_CLIENT_SECRET are set; self-hosters never need it.
// Pure parts (cookies, ID token checks, which account) are exported for tests/openctrlLogin.test.ts; the Supabase side
// is src/lib/openctrlBridge.ts. Same protocol and rules as Clayform's src/lib/openctrlLogin.ts.
import "server-only";
import crypto from "node:crypto";

export const DEFAULT_ISSUER = "https://openctrl.app";
export const STATE_COOKIE = "cr_oc_state";
export const LINK_COOKIE = "cr_oc_link";
export const STATE_TTL_S = 10 * 60;
const CLOCK_SKEW_S = 60;

export interface OpenctrlConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export function openctrlConfig(): OpenctrlConfig | null {
  const clientId = process.env.OPENCTRL_CLIENT_ID;
  const clientSecret = process.env.OPENCTRL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { issuer: (process.env.OPENCTRL_ISSUER || DEFAULT_ISSUER).replace(/\/$/, ""), clientId, clientSecret };
}

export const openctrlEnabled = () => openctrlConfig() !== null;

// ---- Signed cookies ------------------------------------------------------------------------------------------

/** Cookies are signed with a key derived from the client secret, so no extra secret is needed. */
function sign(secret: string, value: string): string {
  const key = crypto.createHash("sha256").update(`ctrlroom-openctrl-cookie:${secret}`).digest();
  return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

export function sealCookie(secret: string, purpose: string, value: Record<string, unknown>, ttlS: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, exp: Math.floor(now / 1000) + ttlS })).toString("base64url");
  return `${body}.${sign(secret, `${purpose}:${body}`)}`;
}

export function openCookie<T>(secret: string, purpose: string, raw: string | undefined, now = Date.now()): T | null {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, `${purpose}:${body}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof v.exp === "number" && v.exp * 1000 > now ? v : null;
  } catch {
    return null;
  }
}

export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  /** Where to go after signing in (already through safeNext). */
  next: string;
}

/** Where to send the browser, plus the cookie that remembers this attempt. */
export function startLogin(config: OpenctrlConfig, authorizationEndpoint: string, redirectUri: string, next: string, now = Date.now()) {
  const pending: PendingLogin = {
    state: crypto.randomBytes(24).toString("base64url"),
    nonce: crypto.randomBytes(24).toString("base64url"),
    verifier: crypto.randomBytes(48).toString("base64url"),
    next,
  };
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email cloud",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: crypto.createHash("sha256").update(pending.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), cookie: sealCookie(config.clientSecret, "oc-state", { ...pending }, STATE_TTL_S, now) };
}

// ---- Discovery, keys, token exchange ---------------------------------------------------------------------------

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
type Jwk = { kty: string; kid?: string; n?: string; e?: string; alg?: string };

const cache: { discovery?: { issuer: string; doc: Discovery; at: number }; jwks?: { uri: string; keys: Jwk[]; at: number } } = {};
const CACHE_MS = 60 * 60 * 1000;

export async function discover(issuer: string, fetcher: typeof fetch = fetch): Promise<Discovery> {
  if (cache.discovery?.issuer === issuer && Date.now() - cache.discovery.at < CACHE_MS) return cache.discovery.doc;
  const res = await fetcher(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`OpenCtrl discovery failed (${res.status})`);
  const doc = (await res.json()) as Discovery;
  // The document must name the issuer we asked for (OIDC Discovery §4.3).
  if (doc.issuer !== issuer) throw new Error("OpenCtrl discovery returned a different issuer");
  cache.discovery = { issuer, doc, at: Date.now() };
  return doc;
}

async function keyFor(uri: string, kid: string, fetcher: typeof fetch): Promise<Jwk | null> {
  const fresh = cache.jwks?.uri === uri && Date.now() - cache.jwks.at < CACHE_MS;
  const known = fresh ? cache.jwks!.keys.find((k) => k.kid === kid) : undefined;
  if (known) return known;
  // Unknown kid: the provider may have rotated keys, so fetch once more.
  const res = await fetcher(uri, { cache: "no-store" });
  if (!res.ok) throw new Error(`OpenCtrl keys failed (${res.status})`);
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  cache.jwks = { uri, keys, at: Date.now() };
  return keys.find((k) => k.kid === kid) ?? null;
}

export interface OpenctrlClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  openctrl_cloud?: { plan: string; limits?: Record<string, number | null> };
}

/** Checks an ID token's signature and claims (OIDC Core §3.1.3.7). Throws with a reason when anything is off. */
export function verifyIdToken(jwt: string, key: Jwk | ((kid: string) => Jwk | null), expect: { issuer: string; clientId: string; nonce: string }, now = Date.now()): OpenctrlClaims {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("ID token is malformed");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
  // Only RS256: never "none", never HMAC with the public key.
  if (header.alg !== "RS256") throw new Error("ID token uses an unexpected algorithm");
  const jwk = typeof key === "function" ? key(header.kid ?? "") : key;
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("No matching signing key");
  const publicKey = crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  if (!crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))) throw new Error("ID token signature is invalid");
  const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  const nowS = Math.floor(now / 1000);
  if (c.iss !== expect.issuer) throw new Error("ID token is from another issuer");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(expect.clientId)) throw new Error("ID token is for another app");
  if (aud.length > 1 && c.azp !== expect.clientId) throw new Error("ID token is for another app");
  if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_S < nowS) throw new Error("ID token has expired");
  if (typeof c.iat === "number" && c.iat - CLOCK_SKEW_S > nowS) throw new Error("ID token is from the future");
  if (c.nonce !== expect.nonce) throw new Error("ID token nonce doesn't match");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("ID token has no subject");
  return c as unknown as OpenctrlClaims;
}

/** Trades the code for tokens and returns the verified claims. */
export async function finishLogin(config: OpenctrlConfig, pending: PendingLogin, code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<OpenctrlClaims> {
  const d = await discover(config.issuer, fetcher);
  const res = await fetcher(d.token_endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pending.verifier }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`OpenCtrl sign-in failed (${body.error ?? res.status})`);
  const header = JSON.parse(Buffer.from(body.id_token.split(".")[0] ?? "", "base64url").toString("utf8") || "{}") as { kid?: string };
  const jwk = await keyFor(d.jwks_uri, header.kid ?? "", fetcher);
  return verifyIdToken(body.id_token, () => jwk, { issuer: config.issuer, clientId: config.clientId, nonce: pending.nonce });
}

// ---- Which Ctrl Room account ---------------------------------------------------------------------------------

type Account = { id: string; emailConfirmedAt?: string | null; linkedSub?: string | null };

export type LoginDecision =
  | { kind: "login"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create" }
  /** An account with this email exists but we can't be sure it's the same person: ask for its password once. */
  | { kind: "confirm-password"; email: string }
  | { kind: "error"; code: "taken" | "noemail" | "unverified" };

/**
 * What to do after OpenCtrl vouches for someone. Linking by email happens only when both OpenCtrl and Ctrl Room have
 * confirmed that email; otherwise someone could pre-register a victim's email in one place and take over the account
 * in the other. New accounts need an email OpenCtrl confirmed, because Ctrl Room only has confirmed accounts.
 */
export function decideLogin(claims: OpenctrlClaims, linkedUserId: string | null, byEmail: Account | null, current: Account | null): LoginDecision {
  if (linkedUserId) return { kind: "login", userId: linkedUserId };
  if (current) return current.linkedSub ? { kind: "error", code: "taken" } : { kind: "link", userId: current.id };
  if (!claims.email) return { kind: "error", code: "noemail" };
  if (byEmail) {
    if (byEmail.linkedSub) return { kind: "error", code: "taken" };
    if (claims.email_verified && byEmail.emailConfirmedAt) return { kind: "link", userId: byEmail.id };
    return { kind: "confirm-password", email: claims.email };
  }
  return claims.email_verified ? { kind: "create" } : { kind: "error", code: "unverified" };
}
