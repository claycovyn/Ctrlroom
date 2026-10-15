/**
 * OpenCtrl Shift invites, handed out in the OpenCtrl community: anyone who joins `openctrl` and reacts to the pinned
 * post in #waitlist gets a Shift invite link by DM from the OpenCtrl account. This file is the pure part (the signed
 * call to Shift, who qualifies, when to send); src/lib/shiftInviteStore.ts reads and writes Ctrl Room with the service
 * role, and /api/cron/shift-invites runs it every 5 minutes. Tests: tests/shiftInvites.test.ts.
 *
 * No migration: Ctrl Room keeps no state of its own for this.
 *   - Shift is the record of who has an invite: one code per Ctrl Room user id, the same code on every ask
 *     (fresh: false after the first).
 *   - The DM is the record of delivery: anyone the OpenCtrl account has already sent an invite DM to is skipped
 *     without asking Shift again.
 *   - A fresh code is sent straight away. A code that isn't fresh, isn't used and was issued more than
 *     RESEND_AFTER_MS ago with no invite DM to show for it (a DM that failed after Shift issued the code) is sent
 *     again. Two runs at the same moment can't both send: only one gets fresh: true, and the other sees a code
 *     issued seconds ago and leaves it alone.
 *
 * Who qualifies: a person (not a bot) who is a member of the community, isn't banned, has a confirmed email, and takes
 * DMs from OpenCtrl. "Who can message you" decides that last part: "Nobody" means no DM, so the person is skipped
 * and nothing is recorded or asked of Shift (they can react again after changing it; the next run picks them up).
 * The default ("People in your communities") and "Anyone" allow it: the OpenCtrl account speaks for the community
 * they just asked in. Blocks, in either direction, also mean skip.
 *
 * Shift saying 429 (today's invites are out) or 410 (Shift is open to everyone) ends the run; the next run carries on.
 */
import { createHmac, randomBytes } from "node:crypto";

export const OPENCTRL_BOT_ID = "00000000-0000-4000-8000-00000000c7a2";
export const COMMUNITY_SLUG = "openctrl";
export const ROOM_SLUG = "waitlist";
export const DEFAULT_SHIFT_ISSUE_URL = "https://shift.openctrl.app/api/invites/issue";
/** Every invite DM starts with this; it's how a delivered invite is recognised. */
export const DM_PREFIX = "Here's your invite to OpenCtrl Shift: ";
/** A code that was issued but has no DM after this long is sent again. */
export const RESEND_AFTER_MS = 10 * 60_000;
/** Per run: DMs stay under the flood guard (30 a minute per author, 0011); people checked (email, then Shift) are capped
 * so a run finishes well in time. Whoever is left over is picked up by the next run. */
export const MAX_DMS_PER_RUN = 20;
export const MAX_ASKS_PER_RUN = 40;

export const inviteDm = (url: string) => `${DM_PREFIX}${url}. It works once. Once you're in, you'll get five of your own to share.`;

// ── The signed call to Shift ──────────────────────────────────────────────────────────────────────────────────────
// HMAC-SHA256 over "<unix seconds>.<nonce>.<raw body>" with SHIFT_CTRLROOM_SECRET (Shift: src/lib/shift/server/ctrlroom.ts).

export const SHIFT_HEADERS = { timestamp: "x-shift-timestamp", nonce: "x-shift-nonce", signature: "x-shift-signature" } as const;

export function signShift(secret: string, timestamp: string, nonce: string, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

export type ShiftAnswer =
  | { kind: "ok"; code: string; url: string; fresh: boolean; used: boolean; issuedAt: string }
  | { kind: "capped"; retryAfter: number }
  | { kind: "closed" }
  | { kind: "error"; status: number };

export type ShiftClient = (externalId: string) => Promise<ShiftAnswer>;

export function shiftClient(o: { url: string; secret: string; fetch?: typeof fetch; now?: () => number }): ShiftClient {
  const f = o.fetch ?? fetch;
  return async (externalId) => {
    const body = JSON.stringify({ externalId, source: "ctrlroom" });
    const ts = String(Math.floor((o.now?.() ?? Date.now()) / 1000));
    const nonce = randomBytes(18).toString("base64url");
    let res: Response;
    try {
      res = await f(o.url, {
        method: "POST",
        headers: { "content-type": "application/json", [SHIFT_HEADERS.timestamp]: ts, [SHIFT_HEADERS.nonce]: nonce, [SHIFT_HEADERS.signature]: signShift(o.secret, ts, nonce, body) },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { kind: "error", status: 0 };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 429) return { kind: "capped", retryAfter: Number(data.retryAfter ?? res.headers.get("retry-after") ?? 0) || 0 };
    if (res.status === 410) return { kind: "closed" };
    if (!res.ok || typeof data.code !== "string" || typeof data.url !== "string" || !/^https:\/\//.test(data.url)) return { kind: "error", status: res.status };
    return { kind: "ok", code: data.code, url: data.url, fresh: data.fresh === true, used: data.used === true, issuedAt: String(data.issuedAt ?? "") };
  };
}

// ── Who qualifies, and the run ────────────────────────────────────────────────────────────────────────────────────

export type WhoCanDm = "shared_community" | "anyone" | "nobody";

/** What Ctrl Room knows about one person who reacted. */
export interface Reactor {
  id: string;
  isBot: boolean;
  member: boolean;
  banned: boolean;
  whoCanDm: WhoCanDm;
  /** Either of them blocked the other. */
  blocked: boolean;
}

export type Skip = "bot" | "not_member" | "banned" | "dm_off" | "blocked" | "unconfirmed";

export function skipReason(r: Reactor): Exclude<Skip, "unconfirmed"> | null {
  if (r.isBot || r.id === OPENCTRL_BOT_ID) return "bot";
  if (!r.member) return "not_member";
  if (r.banned) return "banned";
  if (r.blocked) return "blocked";
  if (r.whoCanDm === "nobody") return "dm_off";
  return null;
}

/** What the run needs from Ctrl Room (src/lib/shiftInviteStore.ts over Supabase; an in-memory one in the tests). */
export interface InviteStore {
  /** The pinned invite post: its message id, or null if there isn't one. */
  inviteMessage(): Promise<string | null>;
  /** Everyone who reacted to it, each once, in the order of their first reaction. */
  reactorIds(messageId: string): Promise<string[]>;
  /** People the OpenCtrl account has already sent an invite DM to. */
  deliveredTo(): Promise<Set<string>>;
  reactors(ids: string[]): Promise<Reactor[]>;
  emailConfirmed(id: string): Promise<boolean>;
  /** Sends a DM from the OpenCtrl account (their 1:1 conversation, made the first time). */
  sendDm(userId: string, body: string): Promise<void>;
}

export interface RunResult {
  message: string | null;
  reactors: number;
  alreadySent: number;
  asked: number;
  sent: number;
  resent: number;
  skipped: Partial<Record<Skip, number>>;
  failed: number;
  stopped: null | "capped" | "closed" | "shift_error" | "limit";
  retryAfter?: number;
}

export async function runShiftInvites(store: InviteStore, shift: ShiftClient, o: { now?: () => number; maxDms?: number; maxAsks?: number } = {}): Promise<RunResult> {
  const now = o.now ?? Date.now;
  const maxDms = o.maxDms ?? MAX_DMS_PER_RUN;
  const maxAsks = o.maxAsks ?? MAX_ASKS_PER_RUN;
  const out: RunResult = { message: null, reactors: 0, alreadySent: 0, asked: 0, sent: 0, resent: 0, skipped: {}, failed: 0, stopped: null };
  const skip = (why: Skip) => (out.skipped[why] = (out.skipped[why] ?? 0) + 1);
  let checks = 0;

  out.message = await store.inviteMessage();
  if (!out.message) return out;
  const ids = await store.reactorIds(out.message);
  out.reactors = ids.length;
  if (!ids.length) return out;
  const delivered = await store.deliveredTo();
  const waiting = ids.filter((id) => !delivered.has(id));
  out.alreadySent = ids.length - waiting.length;
  if (!waiting.length) return out;

  const facts = new Map((await store.reactors(waiting)).map((r) => [r.id, r]));
  for (const id of waiting) {
    const r = facts.get(id);
    if (!r) {
      skip("not_member");
      continue;
    }
    const why = skipReason(r);
    if (why) {
      skip(why);
      continue;
    }
    if (out.sent + out.resent >= maxDms || checks >= maxAsks) {
      out.stopped = "limit";
      break;
    }
    checks++;
    if (!(await store.emailConfirmed(id))) {
      skip("unconfirmed");
      continue;
    }
    out.asked++;
    const a = await shift(id);
    if (a.kind === "capped") {
      out.stopped = "capped";
      out.retryAfter = a.retryAfter;
      break;
    }
    if (a.kind === "closed") {
      out.stopped = "closed";
      break;
    }
    if (a.kind === "error") {
      out.stopped = "shift_error";
      break;
    }
    const stale = !a.fresh && !a.used && now() - Date.parse(a.issuedAt) >= RESEND_AFTER_MS;
    if (!a.fresh && !stale) continue;
    try {
      await store.sendDm(id, inviteDm(a.url));
      if (a.fresh) out.sent++;
      else out.resent++;
    } catch {
      // Shift has the code; a later run sends it once RESEND_AFTER_MS has passed.
      out.failed++;
    }
  }
  return out;
}
