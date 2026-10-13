import { describe, expect, it } from "vitest";
import {
  AWAY_AFTER_MS,
  callRooms,
  callStarts,
  computeStatus,
  displayStatus,
  initialPresence,
  mergePresence,
  parseManual,
  payloadFor,
  presenceGroup,
  reducePresence,
  selfPeer,
  statusLabel,
  validatePresence,
  type PeerPresence,
} from "@/lib/presence";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const ROOM = "c0000000-0000-4000-8000-000000000001";
const T0 = 1_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("status reducer", () => {
  it("starts Online", () => {
    expect(initialPresence("auto", T0).status).toBe("online");
  });
  it("idle 5 minutes → Away (a hidden tab gets no input, so it counts the same)", () => {
    const s = initialPresence("auto", T0);
    const almost = reducePresence(s, { type: "tick", now: T0 + AWAY_AFTER_MS - 1, lastActive: T0 });
    expect(almost).toBe(s); // unchanged → same object, nothing re-tracked
    const away = reducePresence(s, { type: "tick", now: T0 + AWAY_AFTER_MS, lastActive: T0 });
    expect(away.status).toBe("away");
    expect(away.since).toBe(T0 + AWAY_AFTER_MS);
  });
  it("activity → back to Online", () => {
    const away = reducePresence(initialPresence("auto", T0), { type: "tick", now: T0 + AWAY_AFTER_MS, lastActive: T0 });
    const back = reducePresence(away, { type: "tick", now: T0 + AWAY_AFTER_MS + 10, lastActive: T0 + AWAY_AFTER_MS + 10 });
    expect(back.status).toBe("online");
  });
  it("a call keeps you Online however long you're idle, and shows as In a call", () => {
    let s = reducePresence(initialPresence("auto", T0), { type: "call", call: { room_id: ROOM, video: false }, now: T0 });
    s = reducePresence(s, { type: "tick", now: T0 + 3 * AWAY_AFTER_MS, lastActive: T0 });
    expect(s.status).toBe("online");
    expect(displayStatus(selfPeer(s))).toBe("call");
    s = reducePresence(s, { type: "call", call: { room_id: ROOM, video: true }, now: T0 + 1 });
    expect(s.call).toEqual({ room_id: ROOM, video: true });
    s = reducePresence(s, { type: "call", call: null, now: T0 + 2 });
    expect(s.call).toBeNull();
  });
  it("Do not disturb wins over idle and call", () => {
    expect(computeStatus("dnd", null, T0 + AWAY_AFTER_MS * 2, T0)).toBe("dnd");
    expect(computeStatus("dnd", { room_id: ROOM, video: false }, T0, T0)).toBe("dnd");
    const s = reducePresence(initialPresence("auto", T0), { type: "manual", manual: "dnd", now: T0, lastActive: T0 });
    expect(s.status).toBe("dnd");
    expect(payloadFor(s, A)?.status).toBe("dnd");
  });
  it("Appear offline tracks nothing at all", () => {
    const s = reducePresence(initialPresence("auto", T0), { type: "manual", manual: "invisible", now: T0, lastActive: T0 });
    expect(payloadFor(s, A)).toBeNull();
    expect(selfPeer(s)).toBeUndefined();
    expect(displayStatus(selfPeer(s))).toBe("offline");
    const withCall = reducePresence(s, { type: "call", call: { room_id: ROOM, video: false }, now: T0 });
    expect(payloadFor(withCall, A)).toBeNull();
  });
  it("payload shape", () => {
    expect(payloadFor(initialPresence("auto", T0), A)).toEqual({ user_id: A, status: "online", call: null, since: iso(T0) });
  });
  it("saved menu choice parses safely", () => {
    expect(parseManual("dnd")).toBe("dnd");
    expect(parseManual("invisible")).toBe("invisible");
    expect(parseManual("online")).toBe("auto");
    expect(parseManual(null)).toBe("auto");
  });
});

describe("validatePresence", () => {
  const good = { user_id: A, status: "online", call: null, since: iso(T0) };
  it("accepts a good payload (and drops extra keys like presence_ref)", () => {
    expect(validatePresence({ ...good, presence_ref: "x" })).toEqual(good);
    expect(validatePresence({ ...good, call: { room_id: ROOM, video: true } })?.call).toEqual({ room_id: ROOM, video: true });
  });
  it("rejects bad payloads", () => {
    for (const bad of [
      null,
      "online",
      { ...good, user_id: "not-a-uuid" },
      { ...good, status: "busy" },
      { ...good, status: "offline" },
      { ...good, call: { room_id: ROOM } },
      { ...good, call: { room_id: "x", video: false } },
      { ...good, call: { room_id: ROOM, video: "yes" } },
      { ...good, call: { room_id: ROOM, video: false, extra: "<script>" } },
      { ...good, since: "yesterday" },
      { user_id: A, status: "online", since: iso(T0) },
    ]) {
      expect(validatePresence(bad)).toBeNull();
    }
  });
});

describe("mergePresence", () => {
  const p = (user: string, status: string, call: unknown = null, since = iso(T0)) => ({ user_id: user, status, call, since, presence_ref: "r" });
  it("one entry per person; payloads must match their key", () => {
    const out = mergePresence({ [A]: [p(A, "online")], [B]: [p(A, "online")] });
    expect(Object.keys(out)).toEqual([A]);
  });
  it("drops invalid tabs, keeps valid ones", () => {
    expect(mergePresence({ [A]: [{ junk: true }, p(A, "away")] })[A].status).toBe("away");
    expect(mergePresence({ [A]: [{ junk: true }] })[A]).toBeUndefined();
  });
  it("several tabs: DND > Online > Away; call from any tab", () => {
    expect(mergePresence({ [A]: [p(A, "away"), p(A, "online")] })[A].status).toBe("online");
    expect(mergePresence({ [A]: [p(A, "online"), p(A, "dnd")] })[A].status).toBe("dnd");
    const call = { room_id: ROOM, video: false };
    expect(mergePresence({ [A]: [p(A, "away"), p(A, "online", call)] })[A].call).toEqual(call);
  });
});

describe("display", () => {
  const rooms = (id: string) => (id === ROOM ? "voice-lounge" : undefined);
  const peer = (over: Partial<PeerPresence>): PeerPresence => ({ status: "online", call: null, since: iso(T0), ...over });
  it("labels", () => {
    expect(statusLabel(undefined, rooms)).toBe("Offline");
    expect(statusLabel(peer({}), rooms)).toBe("Online");
    expect(statusLabel(peer({ status: "away" }), rooms)).toBe("Away");
    expect(statusLabel(peer({ status: "dnd" }), rooms)).toBe("Do not disturb");
    expect(statusLabel(peer({ call: { room_id: ROOM, video: false } }), rooms)).toBe("In a call in #voice-lounge");
    expect(statusLabel(peer({ call: { room_id: ROOM, video: true } }), rooms)).toBe("In a video call in #voice-lounge");
    expect(statusLabel(peer({ status: "dnd", call: { room_id: ROOM, video: false } }), rooms)).toBe("Do not disturb · in a call in #voice-lounge");
    expect(statusLabel(peer({ call: { room_id: B, video: false } }), rooms)).toBe("In a call");
  });
  it("call precedence over Online/Away; DND over call", () => {
    expect(displayStatus(peer({ status: "away", call: { room_id: ROOM, video: false } }))).toBe("call");
    expect(displayStatus(peer({ status: "dnd", call: { room_id: ROOM, video: false } }))).toBe("dnd");
  });
  it("member groups", () => {
    expect(presenceGroup(undefined)).toBe("offline");
    expect(presenceGroup(peer({ status: "dnd" }))).toBe("online");
    expect(presenceGroup(peer({ status: "away" }))).toBe("away");
    expect(presenceGroup(peer({ status: "dnd", call: { room_id: ROOM, video: false } }))).toBe("call");
  });
});

describe("calls", () => {
  const inCall = (room: string): PeerPresence => ({ status: "online", call: { room_id: room, video: false }, since: iso(T0) });
  it("callRooms lists people per room", () => {
    expect(callRooms({ [B]: inCall(ROOM), [A]: inCall(ROOM) })).toEqual({ [ROOM]: [A, B].sort() });
  });
  it("callStarts: a room going from nobody (else) to someone", () => {
    expect(callStarts({}, { [ROOM]: [B] }, A)).toEqual([{ room_id: ROOM, by: B }]);
    expect(callStarts({ [ROOM]: [B] }, { [ROOM]: [A, B] }, A)).toEqual([]);
    expect(callStarts({ [ROOM]: [A] }, { [ROOM]: [A, B] }, A)).toEqual([{ room_id: ROOM, by: B }]);
    expect(callStarts({}, { [ROOM]: [A] }, A)).toEqual([]); // you starting one doesn't ring you
  });
});
