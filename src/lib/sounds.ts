/**
 * Notification sounds (public/sounds/*.wav, 24 kHz mono, made for Ctrl Room).
 *
 * The rules for when a sound may play are pure (`soundAllowed`) so they're unit-tested; the player below is the only
 * part that touches the browser. Settings live in localStorage, per device. Nothing ever plays before the first click
 * or key press on the page (browsers require it, and it means a reload never makes noise on its own).
 */

export const SOUND_NAMES = ["message", "mention", "dm", "call-join", "call-leave", "call-incoming", "mute", "unmute", "sent"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** The per-type switches in Settings → Sounds. */
export type SoundKind = "messages" | "mentions" | "calls" | "mic" | "sent";

export const SOUND_KIND: Record<SoundName, SoundKind> = {
  message: "messages",
  mention: "mentions",
  dm: "mentions",
  "call-join": "calls",
  "call-leave": "calls",
  "call-incoming": "calls",
  mute: "mic",
  unmute: "mic",
  sent: "sent",
};

export interface SoundPrefs {
  enabled: boolean;
  /** 0–1. */
  volume: number;
  kinds: Record<SoundKind, boolean>;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  enabled: true,
  volume: 0.7,
  kinds: { messages: true, mentions: true, calls: true, mic: true, sent: false },
};

/** The least time between two plays of the same sound. */
export const THROTTLE_MS: Record<SoundName, number> = {
  message: 2000,
  mention: 1000,
  dm: 1000,
  "call-join": 1000,
  "call-leave": 1000,
  "call-incoming": 1000,
  mute: 1000,
  unmute: 1000,
  sent: 1000,
};

/** A message tap right after a mention chime for (most likely) the same message is just noise. */
export const MESSAGE_AFTER_MENTION_MS = 1500;

export type RoomNotify = "all" | "mentions" | "none";

export interface SoundContext {
  prefs: SoundPrefs;
  /** Do not disturb is on (presence status menu). */
  dnd: boolean;
  /** A click or key press has happened on this page. */
  unlocked: boolean;
  now: number;
  /** When each sound last played (ms). */
  lastPlayed: Partial<Record<SoundName, number>>;
  /** For message / mention: the room's notification setting (room header bell). */
  roomNotify?: RoomNotify;
  /** For message: the room it arrived in, the room on screen, and whether the tab is hidden. */
  roomId?: string | null;
  viewingRoomId?: string | null;
  hidden?: boolean;
}

/** Whether `name` may play now. Pure. */
export function soundAllowed(name: SoundName, c: SoundContext): boolean {
  if (!c.unlocked || !c.prefs.enabled || c.dnd) return false;
  if (!c.prefs.kinds[SOUND_KIND[name]]) return false;
  if (c.prefs.volume <= 0) return false;
  const last = c.lastPlayed[name];
  if (last !== undefined && c.now - last < THROTTLE_MS[name]) return false;
  if (name === "message") {
    // Only rooms set to "Everything"; never the room you're looking at.
    if (c.roomNotify !== "all") return false;
    if (!c.hidden && c.roomId && c.roomId === c.viewingRoomId) return false;
    const chime = Math.max(c.lastPlayed.mention ?? -Infinity, c.lastPlayed.dm ?? -Infinity);
    if (c.now - chime < MESSAGE_AFTER_MENTION_MS) return false;
  }
  if ((name === "mention" || name === "dm") && c.roomNotify === "none") return false;
  return true;
}

// ───────────────────────── settings (localStorage, per device) ─────────────────────────

const PREFS_KEY = "ctrlroom:sounds";

export function parseSoundPrefs(raw: string | null): SoundPrefs {
  const d = DEFAULT_SOUND_PREFS;
  if (!raw) return { ...d, kinds: { ...d.kinds } };
  try {
    const v = JSON.parse(raw) as Partial<SoundPrefs> | null;
    const kinds = { ...d.kinds };
    if (v && typeof v.kinds === "object" && v.kinds) {
      for (const k of Object.keys(kinds) as SoundKind[]) {
        if (typeof v.kinds[k] === "boolean") kinds[k] = v.kinds[k];
      }
    }
    const volume = typeof v?.volume === "number" && Number.isFinite(v.volume) ? Math.min(1, Math.max(0, v.volume)) : d.volume;
    return { enabled: typeof v?.enabled === "boolean" ? v.enabled : d.enabled, volume, kinds };
  } catch {
    return { ...d, kinds: { ...d.kinds } };
  }
}

export function readSoundPrefs(): SoundPrefs {
  try {
    return parseSoundPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parseSoundPrefs(null);
  }
}

export function writeSoundPrefs(p: SoundPrefs): void {
  prefsCache = p;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // private mode or storage blocked: the choice lasts for this page only
  }
}

// ───────────────────────── player (browser only) ─────────────────────────

let prefsCache: SoundPrefs | null = null;
let dnd = false;
let unlocked = false;
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>();
const lastPlayed: Partial<Record<SoundName, number>> = {};

/** Set by presence (Do not disturb). */
export function setDoNotDisturb(on: boolean): void {
  dnd = on;
}

function prefs(): SoundPrefs {
  if (!prefsCache) prefsCache = readSoundPrefs();
  return prefsCache;
}

const url = (name: SoundName) => `/sounds/${name}.wav`;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    gain = ctx.createGain();
    gain.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function buffer(name: SoundName): Promise<AudioBuffer | null> {
  let b = buffers.get(name);
  if (!b) {
    const ac = audioContext();
    b = !ac
      ? Promise.resolve(null)
      : fetch(url(name))
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((data) => ac.decodeAudioData(data))
          .catch(() => {
            buffers.delete(name); // try again next time
            return null;
          });
    buffers.set(name, b);
  }
  return b;
}

/** Call once on the client. Waits for the first click / key press, then wakes the audio context. */
export function installSoundUnlock(): void {
  if (typeof window === "undefined" || unlocked) return;
  const unlock = () => {
    unlocked = true;
    const ac = audioContext();
    if (ac && ac.state === "suspended") ac.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) refreshSoundPrefs();
  });
}

export interface PlayOptions {
  roomNotify?: RoomNotify;
  roomId?: string | null;
  viewingRoomId?: string | null;
  /** Repeat until the returned stop() is called. */
  loop?: boolean;
  /** Settings preview: ignores the on/off switches and Do not disturb, keeps the volume. */
  preview?: boolean;
}

/** Plays a sound if the rules allow it. Returns a stop function (a no-op when nothing played). */
export function play(name: SoundName, opts: PlayOptions = {}): () => void {
  const noop = () => {};
  if (typeof window === "undefined") return noop;
  const p = prefs();
  const now = Date.now();
  const allowed = opts.preview
    ? unlocked && p.volume > 0
    : soundAllowed(name, {
        prefs: p,
        dnd,
        unlocked,
        now,
        lastPlayed,
        roomNotify: opts.roomNotify,
        roomId: opts.roomId,
        viewingRoomId: opts.viewingRoomId,
        hidden: document.hidden,
      });
  if (!allowed) return noop;
  lastPlayed[name] = now;

  let stopped = false;
  let stopNow: () => void = noop;
  const ac = audioContext();
  if (ac && gain) {
    if (ac.state === "suspended") ac.resume().catch(() => {});
    gain.gain.value = p.volume;
    buffer(name).then((buf) => {
      if (stopped) return;
      if (!buf) return fallback();
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = Boolean(opts.loop);
      src.connect(gain!);
      src.start();
      stopNow = () => {
        try {
          src.stop();
        } catch {
          // already ended
        }
        src.disconnect();
      };
    });
  } else {
    fallback();
  }

  function fallback() {
    try {
      const el = new Audio(url(name));
      el.volume = p.volume;
      el.loop = Boolean(opts.loop);
      el.play().catch(() => {});
      stopNow = () => {
        el.pause();
        el.src = "";
      };
    } catch {
      // no audio at all
    }
  }

  return () => {
    stopped = true;
    stopNow();
  };
}

/** Re-read settings (after they change in Settings → Sounds or in another tab). */
export function refreshSoundPrefs(): void {
  prefsCache = readSoundPrefs();
}
