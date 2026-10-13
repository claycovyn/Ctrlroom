import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_PREFS, parseSoundPrefs, soundAllowed, THROTTLE_MS, UNLOCK_EVENTS, type SoundContext, type SoundPrefs } from "@/lib/sounds";

describe("UNLOCK_EVENTS", () => {
  it("never wakes the audio on a finger down or up (that's the start and end of a swipe)", () => {
    expect(UNLOCK_EVENTS).not.toContain("pointerdown");
    expect(UNLOCK_EVENTS).not.toContain("touchstart");
    expect(UNLOCK_EVENTS).not.toContain("touchend");
    expect(UNLOCK_EVENTS).toContain("click");
  });
});

const prefs = (over: Partial<SoundPrefs> = {}): SoundPrefs => ({ ...DEFAULT_SOUND_PREFS, kinds: { ...DEFAULT_SOUND_PREFS.kinds }, ...over });
const base = (over: Partial<SoundContext> = {}): SoundContext => ({
  prefs: prefs(),
  dnd: false,
  unlocked: true,
  now: 100_000,
  lastPlayed: {},
  ...over,
});

describe("soundAllowed: always-off cases", () => {
  it("never before a user gesture", () => {
    expect(soundAllowed("mention", base({ unlocked: false }))).toBe(false);
    expect(soundAllowed("mention", base())).toBe(true);
  });
  it("master switch off silences everything", () => {
    for (const n of ["message", "mention", "call-join", "mute", "sent"] as const) {
      expect(soundAllowed(n, base({ prefs: prefs({ enabled: false }), roomNotify: "all" }))).toBe(false);
    }
  });
  it("Do not disturb silences everything, mentions too", () => {
    for (const n of ["message", "mention", "call-join", "call-incoming", "unmute"] as const) {
      expect(soundAllowed(n, base({ dnd: true, roomNotify: "all" }))).toBe(false);
    }
  });
  it("volume 0 plays nothing", () => {
    expect(soundAllowed("mention", base({ prefs: prefs({ volume: 0 }) }))).toBe(false);
  });
  it("per-type switches", () => {
    const off = (k: keyof SoundPrefs["kinds"]) => prefs({ kinds: { ...DEFAULT_SOUND_PREFS.kinds, [k]: false } });
    expect(soundAllowed("call-join", base({ prefs: off("calls") }))).toBe(false);
    expect(soundAllowed("call-incoming", base({ prefs: off("calls") }))).toBe(false);
    expect(soundAllowed("mute", base({ prefs: off("mic") }))).toBe(false);
    expect(soundAllowed("mention", base({ prefs: off("mentions") }))).toBe(false);
    expect(soundAllowed("message", base({ prefs: off("messages"), roomNotify: "all" }))).toBe(false);
    expect(soundAllowed("call-join", base({ prefs: off("mic") }))).toBe(true);
  });
  it("sent is off by default", () => {
    expect(soundAllowed("sent", base())).toBe(false);
    expect(soundAllowed("sent", base({ prefs: prefs({ kinds: { ...DEFAULT_SOUND_PREFS.kinds, sent: true } }) }))).toBe(true);
  });
});

describe("soundAllowed: messages", () => {
  const msg = (over: Partial<SoundContext> = {}) => soundAllowed("message", base({ roomNotify: "all", roomId: "r1", viewingRoomId: "r2", hidden: false, ...over }));
  it("plays for another room set to Everything", () => expect(msg()).toBe(true));
  it("only for rooms set to Everything (the default Mentions and Muted stay quiet)", () => {
    expect(msg({ roomNotify: "mentions" })).toBe(false);
    expect(msg({ roomNotify: "none" })).toBe(false);
    expect(msg({ roomNotify: undefined })).toBe(false);
  });
  it("not for the room on screen, unless the tab is hidden", () => {
    expect(msg({ viewingRoomId: "r1" })).toBe(false);
    expect(msg({ viewingRoomId: "r1", hidden: true })).toBe(true);
  });
  it("at most once every 2 s", () => {
    expect(THROTTLE_MS.message).toBe(2000);
    expect(msg({ lastPlayed: { message: 100_000 - 1999 } })).toBe(false);
    expect(msg({ lastPlayed: { message: 100_000 - 2000 } })).toBe(true);
  });
  it("skipped right after a mention chime", () => {
    expect(msg({ lastPlayed: { mention: 100_000 - 500 } })).toBe(false);
    expect(msg({ lastPlayed: { mention: 100_000 - 5000 } })).toBe(true);
  });
});

describe("soundAllowed: mentions and calls", () => {
  it("mentions play even in the room on screen", () => {
    expect(soundAllowed("mention", base({ roomNotify: "mentions", roomId: "r1", viewingRoomId: "r1" }))).toBe(true);
  });
  it("muted room: no mention sound either", () => {
    expect(soundAllowed("mention", base({ roomNotify: "none" }))).toBe(false);
  });
  it("other sounds at most once a second, each on its own clock", () => {
    expect(soundAllowed("call-join", base({ lastPlayed: { "call-join": 100_000 - 999 } }))).toBe(false);
    expect(soundAllowed("call-join", base({ lastPlayed: { "call-join": 100_000 - 1000 } }))).toBe(true);
    expect(soundAllowed("call-leave", base({ lastPlayed: { "call-join": 100_000 - 10 } }))).toBe(true);
  });
});

describe("parseSoundPrefs", () => {
  it("defaults: on, 70%, everything but Sent", () => {
    expect(parseSoundPrefs(null)).toEqual({ enabled: true, volume: 0.7, kinds: { messages: true, mentions: true, calls: true, mic: true, sent: false } });
  });
  it("survives junk and clamps volume", () => {
    expect(parseSoundPrefs("{not json")).toEqual(parseSoundPrefs(null));
    expect(parseSoundPrefs("null")).toEqual(parseSoundPrefs(null));
    expect(parseSoundPrefs(JSON.stringify({ volume: 7 })).volume).toBe(1);
    expect(parseSoundPrefs(JSON.stringify({ volume: -1 })).volume).toBe(0);
    expect(parseSoundPrefs(JSON.stringify({ volume: "loud", enabled: "yes" }))).toEqual(parseSoundPrefs(null));
  });
  it("keeps saved choices and fills in new switches", () => {
    const p = parseSoundPrefs(JSON.stringify({ enabled: false, volume: 0.3, kinds: { calls: false, bogus: true } }));
    expect(p).toEqual({ enabled: false, volume: 0.3, kinds: { messages: true, mentions: true, calls: false, mic: true, sent: false } });
  });
});
