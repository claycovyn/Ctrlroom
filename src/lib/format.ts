import type { Message, Reaction } from "./types";

export function slugify(input: string, max = 40): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export type Token =
  | { type: "text"; value: string }
  | { type: "mention"; username: string }
  | { type: "link"; href: string }
  | { type: "code"; value: string }
  | { type: "codeblock"; value: string };

const INLINE = /(`[^`\n]+`)|(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,!?;:])|((?:^|(?<=[^a-zA-Z0-9_]))@[a-zA-Z0-9_]{2,32})/g;

/** Splits a message body into renderable tokens. No HTML is ever produced from user text. */
export function tokenize(body: string): Token[] {
  const out: Token[] = [];
  const parts = body.split(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push({ type: "codeblock", value: part.replace(/\n$/, "") });
      return;
    }
    let last = 0;
    for (const m of part.matchAll(INLINE)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ type: "text", value: part.slice(last, at) });
      if (m[1]) out.push({ type: "code", value: m[1].slice(1, -1) });
      else if (m[2]) out.push({ type: "link", href: m[2] });
      else if (m[3]) out.push({ type: "mention", username: m[3].slice(1).toLowerCase() });
      last = at + m[0].length;
    }
    if (last < part.length) out.push({ type: "text", value: part.slice(last) });
  });
  return out.filter((t) => t.type !== "text" || t.value.length > 0);
}

/** @everyone pings every member when a mod, admin or owner sends it (0019); it's never a username. */
export const EVERYONE = "everyone";

export function mentionsIn(body: string): string[] {
  return [...new Set(tokenize(body).flatMap((t) => (t.type === "mention" ? [t.username] : [])))];
}

/** Insert or replace a message, keeping the list sorted oldest → newest. */
export function upsertMessage(list: Message[], msg: Message): Message[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...list[i], ...msg };
    return next;
  }
  const next = [...list, msg];
  if (list.length && list[list.length - 1].created_at > msg.created_at) {
    next.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }
  return next;
}

export interface Row {
  message: Message;
  /** Same author within a few minutes of the previous message: hide the name/avatar. */
  compact: boolean;
  /** Set when this message starts a new day. */
  day: string | null;
}

const COMPACT_MS = 5 * 60 * 1000;

export function buildRows(messages: Message[], now = new Date()): Row[] {
  let prev: Message | null = null;
  return messages.map((m) => {
    const d = new Date(m.created_at);
    const newDay = !prev || new Date(prev.created_at).toDateString() !== d.toDateString();
    const compact =
      !!prev &&
      !newDay &&
      prev.author_id === m.author_id &&
      !prev.deleted_at &&
      d.getTime() - new Date(prev.created_at).getTime() < COMPACT_MS;
    prev = m;
    return { message: m, compact, day: newDay ? dayLabel(d, now) : null };
  });
}

export function dayLabel(d: Date, now = new Date()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: diff < 7 ? "long" : undefined,
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// toLocaleTimeString builds a formatter on every call (about a millisecond each on a phone, for every message on
// screen); one shared formatter does the same work once.
let timeFormat: Intl.DateTimeFormat | null = null;

export function timeLabel(iso: string): string {
  timeFormat ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return timeFormat.format(new Date(iso));
}

export function sinceLabel(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export function summarizeReactions(reactions: Reaction[], me: string): Map<string, ReactionSummary[]> {
  const byMessage = new Map<string, Map<string, ReactionSummary>>();
  for (const r of reactions) {
    let m = byMessage.get(r.message_id);
    if (!m) byMessage.set(r.message_id, (m = new Map()));
    const s = m.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    s.count += 1;
    if (r.user_id === me) s.mine = true;
    m.set(r.emoji, s);
  }
  return new Map([...byMessage].map(([id, m]) => [id, [...m.values()]]));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A stable hue per user so avatars are distinguishable without uploads. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * `next` with each message's list swapped for the one in `prev` when nothing in it changed, so a reaction on one
 * message re-renders that message only (memoized rows compare by reference).
 */
export function keepSameSummaries(prev: Map<string, ReactionSummary[]> | null, next: Map<string, ReactionSummary[]>): Map<string, ReactionSummary[]> {
  if (!prev) return next;
  const same = (a: ReactionSummary[], b: ReactionSummary[]) =>
    a.length === b.length && a.every((x, i) => x.emoji === b[i].emoji && x.count === b[i].count && x.mine === b[i].mine);
  const out = new Map<string, ReactionSummary[]>();
  for (const [id, list] of next) {
    const old = prev.get(id);
    out.set(id, old && same(old, list) ? old : list);
  }
  return out;
}
