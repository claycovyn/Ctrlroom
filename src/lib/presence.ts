/**
 * Presence: Online, Away, In a call, Do not disturb, Offline. Pure logic (unit-tested in tests/presence.test.ts); the
 * channel itself is in src/components/chat/PresenceContext.tsx.
 *
 * Each open community tracks one payload per tab on the private Realtime topic presence:<community_id>
 * (0010_presence.sql: members only). "Appear offline" never tracks, so you're simply not there.
 */

/** What you picked in the status menu. "auto" = Online, going Away by itself. */
export type ManualStatus = "auto" | "dnd" | "invisible";
/** What a tab tracks. */
export type TrackedStatus = "online" | "away" | "dnd";
/** What everyone else sees. */
export type DisplayStatus = "call" | "online" | "away" | "dnd" | "offline";

export interface CallInfo {
  room_id: string;
  video: boolean;
}

export interface PresencePayload {
  user_id: string;
  status: TrackedStatus;
  call: CallInfo | null;
  since: string;
}

/** One person, merged across their open tabs. */
export interface PeerPresence {
  status: TrackedStatus;
  call: CallInfo | null;
  since: string;
}

export const AWAY_AFTER_MS = 5 * 60_000;

export const presenceTopic = (communityId: string) => `presence:${communityId}`;

// ───────────────────────── your own status ─────────────────────────

export interface LocalPresence {
  manual: ManualStatus;
  call: CallInfo | null;
  status: TrackedStatus;
  /** When status or call last changed (ms). */
  since: number;
}

export type PresenceEvent =
  /** Periodic check, or right after input / the tab coming back. `lastActive` = last input or tab shown (ms). */
  | { type: "tick"; now: number; lastActive: number }
  | { type: "call"; call: CallInfo | null; now: number }
  | { type: "manual"; manual: ManualStatus; now: number; lastActive: number };

/**
 * Do not disturb wins; a call keeps you Online (it shows as In a call); otherwise Away after 5 minutes without input
 * (a hidden tab gets no input, so a tab hidden for 5 minutes is Away too).
 */
export function computeStatus(manual: ManualStatus, call: CallInfo | null, now: number, lastActive: number): TrackedStatus {
  if (manual === "dnd") return "dnd";
  if (call) return "online";
  return now - lastActive >= AWAY_AFTER_MS ? "away" : "online";
}

export function initialPresence(manual: ManualStatus, now: number): LocalPresence {
  return { manual, call: null, status: computeStatus(manual, null, now, now), since: now };
}

const sameCall = (a: CallInfo | null, b: CallInfo | null) => a === b || (!!a && !!b && a.room_id === b.room_id && a.video === b.video);

/** Returns the same object when nothing changed, so React skips the re-render and nothing is re-tracked. */
export function reducePresence(s: LocalPresence, e: PresenceEvent): LocalPresence {
  let manual = s.manual;
  let call = s.call;
  let status: TrackedStatus;
  if (e.type === "call") {
    call = e.call;
    // Joining or leaving a call is activity.
    status = computeStatus(manual, call, e.now, e.now);
  } else {
    if (e.type === "manual") manual = e.manual;
    status = computeStatus(manual, call, e.now, e.lastActive);
  }
  if (manual === s.manual && status === s.status && sameCall(call, s.call)) return s;
  const since = status === s.status && sameCall(call, s.call) ? s.since : e.now;
  return { manual, call, status, since };
}

/** The payload to track, or null to track nothing ("Appear offline"). */
export function payloadFor(s: LocalPresence, userId: string): PresencePayload | null {
  if (s.manual === "invisible") return null;
  return { user_id: userId, status: s.status, call: s.call, since: new Date(s.since).toISOString() };
}

/** How you show to yourself (Appear offline shows as Offline: that's what others see). */
export function selfPeer(s: LocalPresence): PeerPresence | undefined {
  if (s.manual === "invisible") return undefined;
  return { status: s.status, call: s.call, since: new Date(s.since).toISOString() };
}

const MANUAL_KEY = "ctrlroom:status";

export function parseManual(raw: string | null): ManualStatus {
  return raw === "dnd" || raw === "invisible" ? raw : "auto";
}

export function readManual(): ManualStatus {
  try {
    return parseManual(localStorage.getItem(MANUAL_KEY));
  } catch {
    return "auto";
  }
}

export function writeManual(m: ManualStatus): void {
  try {
    if (m === "auto") localStorage.removeItem(MANUAL_KEY);
    else localStorage.setItem(MANUAL_KEY, m);
  } catch {
    // storage blocked: lasts for this page
  }
}

// ───────────────────────── everyone else ─────────────────────────

// Checked by hand rather than with zod: this runs in every app page, and zod alone was about 12 KB of its JavaScript.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO 8601 with seconds and a Z or ±hh:mm offset (what toISOString() writes).
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const STATUSES: readonly string[] = ["online", "away", "dnd"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A tracked payload from the channel (other browsers wrote it, so check everything). Null when it's not valid. */
export function validatePresence(raw: unknown): PresencePayload | null {
  if (!isRecord(raw)) return null;
  const { user_id, status, call, since } = raw;
  if (typeof user_id !== "string" || !UUID.test(user_id)) return null;
  if (typeof status !== "string" || !STATUSES.includes(status)) return null;
  if (typeof since !== "string" || since.length > 40 || !DATETIME.test(since) || !Number.isFinite(Date.parse(since))) return null;
  let callOut: PresencePayload["call"] = null;
  if (call !== null) {
    // Exactly { room_id, video }: nothing extra rides along.
    if (!isRecord(call) || Object.keys(call).length !== 2) return null;
    if (typeof call.room_id !== "string" || !UUID.test(call.room_id) || typeof call.video !== "boolean") return null;
    callOut = { room_id: call.room_id, video: call.video };
  }
  return { user_id, status: status as PresencePayload["status"], call: callOut, since };
}

/**
 * channel.presenceState() → one entry per person. Payloads must be valid and match the key they were tracked under
 * (the app tracks with key = your user id). Several tabs: Do not disturb if any tab says so, else Online if any tab
 * is, else Away; the call is the most recent one.
 */
export function mergePresence(state: Record<string, unknown[]>): Record<string, PeerPresence> {
  const out: Record<string, PeerPresence> = {};
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas)) continue;
    const valid = metas.map(validatePresence).filter((p): p is PresencePayload => !!p && p.user_id === key);
    if (!valid.length) continue;
    const status: TrackedStatus = valid.some((p) => p.status === "dnd") ? "dnd" : valid.some((p) => p.status === "online") ? "online" : "away";
    const calls = valid.filter((p) => p.call).sort((a, b) => (a.since < b.since ? 1 : -1));
    const since = valid.map((p) => p.since).sort()[valid.length - 1];
    out[key] = { status, call: calls[0]?.call ?? null, since };
  }
  return out;
}

/** Do not disturb > In a call > Online > Away. No presence = Offline. */
export function displayStatus(p: PeerPresence | undefined): DisplayStatus {
  if (!p) return "offline";
  if (p.status === "dnd") return "dnd";
  if (p.call) return "call";
  return p.status;
}

/** Accessible text, e.g. "In a call in #voice-lounge". `roomName` looks up a room in this community. */
export function statusLabel(p: PeerPresence | undefined, roomName: (id: string) => string | undefined): string {
  const where = (c: CallInfo) => {
    const name = roomName(c.room_id);
    return `${c.video ? "In a video call" : "In a call"}${name ? ` in #${name}` : ""}`;
  };
  switch (displayStatus(p)) {
    case "dnd":
      return p!.call ? `Do not disturb · ${where(p!.call).toLowerCase()}` : "Do not disturb";
    case "call":
      return where(p!.call!);
    case "online":
      return "Online";
    case "away":
      return "Away";
    default:
      return "Offline";
  }
}

/** Who's in a call in each room: room id → user ids (sorted, for stable rendering). */
export function callRooms(peers: Record<string, PeerPresence>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, p] of Object.entries(peers)) {
    if (p.call) (out[p.call.room_id] ??= []).push(id);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** Rooms where a call started between two snapshots (nobody else in it before, someone now), ignoring `me`. */
export function callStarts(prev: Record<string, string[]>, next: Record<string, string[]>, me: string): { room_id: string; by: string }[] {
  const others = (list: string[] | undefined) => (list ?? []).filter((id) => id !== me);
  const out: { room_id: string; by: string }[] = [];
  for (const [room, list] of Object.entries(next)) {
    const now = others(list);
    if (now.length && !others(prev[room]).length) out.push({ room_id: room, by: now[0] });
  }
  return out;
}

export type PresenceGroup = "call" | "online" | "away" | "offline";
export const GROUP_LABEL: Record<PresenceGroup, string> = { call: "In a call", online: "Online", away: "Away", offline: "Offline" };
export const GROUP_ORDER: PresenceGroup[] = ["call", "online", "away", "offline"];

/** Members panel grouping. Do not disturb counts as Online (or In a call), with its own badge. */
export function presenceGroup(p: PeerPresence | undefined): PresenceGroup {
  if (!p) return "offline";
  if (p.call) return "call";
  return p.status === "away" ? "away" : "online";
}
