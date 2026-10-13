/**
 * Push notifications: the pure parts (no browser, no network), so they're unit-tested in tests/push.test.ts.
 *
 * How a mention becomes a notification is described at the top of supabase/migrations/0014_push.sql. This file has:
 *   - parseSubscription: checks what a browser's PushSubscription.toJSON() handed us before it goes to the DB
 *   - buildPayload: the JSON the service worker (public/sw.js) shows
 *   - drainOutbox: one dispatch run (claim → send to every device → report), with the sender passed in
 *   - pushSupport: whether this browser can get pushes, or needs Ctrl Room added to the Home Screen first (iOS)
 */

export type PushKind = "mention" | "reply" | "dm" | "call";

export interface ParsedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const B64URL = /^[A-Za-z0-9_=-]+$/;

/** A browser push subscription (PushSubscription.toJSON()), or null if it isn't one we'd store (0014's checks). */
export function parseSubscription(raw: unknown): ParsedSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  const endpoint = typeof v.endpoint === "string" ? v.endpoint.trim() : "";
  const p256dh = typeof v.keys?.p256dh === "string" ? v.keys.p256dh : "";
  const auth = typeof v.keys?.auth === "string" ? v.keys.auth : "";
  if (!endpoint || endpoint.length > 1000 || /\s/.test(endpoint)) return null;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (p256dh.length < 20 || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (auth.length < 8 || auth.length > 100 || !B64URL.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** One claimed outbox row (claim_push in 0014). */
export interface OutboxRow {
  id: number;
  user_id: string;
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  tag: string;
  created_at: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: PushKind;
  /** When the event happened (ms), so the device can order and drop stale ones. */
  at: number;
}

/** Push services take about 4 KB; stay well under it whatever the message said. */
export const MAX_PAYLOAD_BYTES = 3000;

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
}

/** Only paths on this site; anything else opens the app. */
export function safePushUrl(url: string): string {
  return /^\/(?!\/)[^\s\\]*$/.test(url) ? url : "/app";
}

/**
 * The JSON the service worker shows. `site` (NEXT_PUBLIC_SITE_URL, via siteUrl()) makes the link absolute; the DB
 * only ever stores paths, so a link can't point anywhere but this site.
 */
export function buildPayload(row: Pick<OutboxRow, "kind" | "title" | "body" | "url" | "tag" | "created_at">, site = ""): string {
  const at = Date.parse(row.created_at);
  const trimmed = site.replace(/\/$/, "");
  const base = /^https?:\/\/[^/\s]+$/.test(trimmed) ? trimmed : "";
  const payload: PushPayload = {
    title: clip(row.title || "Ctrl Room", 120) || "Ctrl Room",
    body: clip(row.body ?? "", 240),
    url: base + safePushUrl(row.url),
    tag: clip(row.tag ?? "", 120),
    kind: row.kind,
    at: Number.isFinite(at) ? at : Date.now(),
  };
  let json = JSON.stringify(payload);
  // Multi-byte text can still be large; trim the body until it fits.
  while (new TextEncoder().encode(json).length > MAX_PAYLOAD_BYTES && payload.body.length > 0) {
    payload.body = clip(payload.body, Math.floor(payload.body.length * 0.75));
    json = JSON.stringify(payload);
  }
  return json;
}

export interface StoredSubscription extends ParsedSubscription {
  user_id: string;
}

/** What a sender reports for one device. */
export type SendResult = { ok: true } | { ok: false; statusCode?: number };

/** The push service says this subscription no longer exists: delete it. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export interface DrainDeps {
  claim: (limit: number) => Promise<OutboxRow[]>;
  subscriptionsFor: (userIds: string[]) => Promise<StoredSubscription[]>;
  send: (sub: StoredSubscription, payload: string, row: OutboxRow) => Promise<SendResult>;
  finish: (done: number[], ok: string[], gone: string[]) => Promise<void>;
  /** The site's address, for absolute links (siteUrl()). */
  site?: string;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  gone: number;
  failed: number;
}

/**
 * One dispatch run. A row is done when at least one device took it, or when every device it was for turned out to
 * be gone, or when the person has no devices left. A row where every device failed for another reason (push service
 * down, 5xx, timeout) stays in the outbox and is retried by a later run (claim_push: up to 3 tries, within an hour).
 */
export async function drainOutbox(deps: DrainDeps, opts: { limit?: number; rounds?: number } = {}): Promise<DrainResult> {
  const limit = opts.limit ?? 100;
  const rounds = opts.rounds ?? 5;
  const total: DrainResult = { claimed: 0, sent: 0, gone: 0, failed: 0 };
  for (let round = 0; round < rounds; round++) {
    const rows = await deps.claim(limit);
    if (!rows.length) break;
    total.claimed += rows.length;
    const subs = await deps.subscriptionsFor([...new Set(rows.map((r) => r.user_id))]);
    const byUser = new Map<string, StoredSubscription[]>();
    for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

    const done: number[] = [];
    const ok = new Set<string>();
    const gone = new Set<string>();
    await Promise.all(
      rows.map(async (row) => {
        const devices = (byUser.get(row.user_id) ?? []).filter((d) => !gone.has(d.endpoint));
        if (!devices.length) return void done.push(row.id);
        const payload = buildPayload(row, deps.site);
        const results = await Promise.all(
          devices.map(async (d) => {
            try {
              return { d, r: await deps.send(d, payload, row) };
            } catch {
              return { d, r: { ok: false } as SendResult };
            }
          }),
        );
        let delivered = false;
        let retry = false;
        for (const { d, r } of results) {
          if (r.ok) {
            delivered = true;
            ok.add(d.endpoint);
            total.sent++;
          } else if (isGone(r.statusCode)) {
            gone.add(d.endpoint);
          } else {
            retry = true;
            total.failed++;
          }
        }
        if (delivered || !retry) done.push(row.id);
      }),
    );
    total.gone += gone.size;
    await deps.finish(done, [...ok].filter((e) => !gone.has(e)), [...gone]);
    if (rows.length < limit) break;
  }
  return total;
}

// ───────────────────────── what this browser can do ─────────────────────────

export interface PushEnv {
  userAgent: string;
  /** navigator.standalone (iOS) or display-mode: standalone. */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  maxTouchPoints?: number;
}

/**
 * "supported": can subscribe now (after a tap).
 * "ios-install": iPhone or iPad Safari outside a Home Screen app; Apple only allows web push for Home Screen apps.
 * "unsupported": no push in this browser.
 */
export type PushSupport = "supported" | "ios-install" | "unsupported";

export function isIOS(ua: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function pushSupport(env: PushEnv): PushSupport {
  const ios = isIOS(env.userAgent, env.maxTouchPoints);
  if (ios && !env.standalone) return "ios-install";
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return "supported";
  return "unsupported";
}

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function vapidKeyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bearer token check for the dispatch route, in constant time for equal lengths. */
export function secretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = header.slice(7);
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
