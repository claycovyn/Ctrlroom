/**
 * Direct messages (supabase/migrations/0011_dms.sql). Types and the pure logic the inbox, the rail badge and the
 * alerts run on (unit-tested in tests/dms.test.ts). The live state is in src/components/dm/DmContext.tsx.
 */
import type { Message } from "./types";

/** People in a group, you included. The database enforces it too (dm_members_guard). */
export const MAX_GROUP = 10;

export type WhoCanDm = "shared_community" | "anyone" | "nobody";
export type DmStatus = "active" | "request" | "left";

export interface DmMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status: DmStatus;
}

export interface DmLastMessage {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted: boolean;
}

/** One row of my_dm_inbox(): the conversation plus your own state in it. */
export interface DmConversation {
  id: string;
  is_group: boolean;
  title: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
  status: DmStatus;
  ignored: boolean;
  muted: boolean;
  last_read_at: string;
  unread: number;
  last_message: DmLastMessage | null;
  members: DmMember[];
}

export interface DmMessage {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface DmReaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

/** What the `dm` event on your user:<id> topic carries (status / ignored / muted are yours). */
export interface DmEvent {
  message: DmMessage;
  conversation_id: string;
  is_group: boolean;
  status: DmStatus;
  ignored: boolean;
  muted: boolean;
  author: string;
}

/** A dm_search_people() row for "New message". */
export interface DmPerson {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  can_message: boolean;
}

export type InboxTab = "chats" | "requests";

/** Where a conversation shows: your chats, Requests, the ignored list, or nowhere (you left). */
export function requestState(c: Pick<DmConversation, "status" | "ignored">): "chat" | "request" | "ignored" | "left" {
  if (c.status === "left") return "left";
  if (c.status === "request") return c.ignored ? "ignored" : "request";
  return "chat";
}

const lastAt = (c: DmConversation) => c.last_message?.created_at ?? c.last_message_at ?? c.created_at;

/** Newest activity first; ties by id so the order never flickers. */
export function sortInbox(list: DmConversation[]): DmConversation[] {
  return [...list].sort((a, b) => {
    const x = lastAt(a);
    const y = lastAt(b);
    if (x !== y) return x < y ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function splitInbox(list: DmConversation[]): { chats: DmConversation[]; requests: DmConversation[]; ignored: DmConversation[] } {
  const sorted = sortInbox(list);
  return {
    chats: sorted.filter((c) => requestState(c) === "chat"),
    requests: sorted.filter((c) => requestState(c) === "request"),
    ignored: sorted.filter((c) => requestState(c) === "ignored"),
  };
}

/** The rail badge: unread messages in chats you haven't muted, plus open requests. Ignored requests never count. */
export function badgeCount(list: DmConversation[]): number {
  let n = 0;
  for (const c of list) {
    const s = requestState(c);
    if (s === "chat" && !c.muted) n += c.unread;
    else if (s === "request") n += 1;
  }
  return n;
}

export function badgeLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Everyone but you who hasn't left. */
export function otherMembers(c: Pick<DmConversation, "members">, meId: string): DmMember[] {
  return c.members.filter((m) => m.user_id !== meId && m.status !== "left");
}

/** The name to show: the group's title, the other person, or "Maya, Sam and 2 others". */
export function conversationName(c: Pick<DmConversation, "title" | "is_group" | "members">, meId: string): string {
  if (c.is_group && c.title) return c.title;
  const others = otherMembers(c, meId).map((m) => m.display_name);
  if (!others.length) return c.is_group ? "Just you" : "Someone";
  if (!c.is_group || others.length === 1) return others[0];
  if (others.length === 2) return `${others[0]} and ${others[1]}`;
  return `${others[0]}, ${others[1]} and ${others.length - 2} ${others.length - 2 === 1 ? "other" : "others"}`;
}

/** The line under the name in the inbox. */
export function previewText(c: Pick<DmConversation, "last_message" | "members" | "is_group">, meId: string): string {
  const m = c.last_message;
  if (!m) return "No messages yet";
  if (m.deleted) return "Message removed";
  const body = m.body.replace(/\s+/g, " ").trim();
  if (m.author_id === meId) return `You: ${body}`;
  if (!c.is_group) return body;
  const who = c.members.find((x) => x.user_id === m.author_id)?.display_name.split(" ")[0] ?? "Someone";
  return `${who}: ${body}`;
}

/**
 * A new message arrived. Returns the updated list, or null when the conversation isn't in it yet (a new request
 * or someone just added you): refetch the inbox then.
 */
export function applyIncoming(list: DmConversation[], e: DmEvent, meId: string, viewingId: string | null): DmConversation[] | null {
  const i = list.findIndex((c) => c.id === e.conversation_id);
  if (i < 0) return null;
  const c = list[i];
  const m = e.message;
  if (c.last_message && c.last_message.id === m.id) return list;
  const counts = m.author_id !== meId && viewingId !== c.id;
  const next = list.slice();
  next[i] = {
    ...c,
    status: e.status,
    ignored: e.ignored,
    muted: e.muted,
    last_message_at: m.created_at,
    last_message:
      c.last_message && c.last_message.created_at > m.created_at
        ? c.last_message
        : { id: m.id, author_id: m.author_id, body: m.body.slice(0, 140), created_at: m.created_at, deleted: Boolean(m.deleted_at) },
    unread: counts ? Math.min(c.unread + 1, 100) : m.author_id === meId || viewingId === c.id ? 0 : c.unread,
  };
  return next;
}

/** After reading a conversation. */
export function markRead(list: DmConversation[], id: string, now: string): DmConversation[] {
  return list.map((c) => (c.id === id ? { ...c, unread: 0, last_read_at: now } : c));
}

/**
 * Whether an incoming DM should make a sound and a desktop alert. Never for your own messages, people you blocked,
 * ignored requests, muted conversations or after leaving. The sound skips the conversation you're looking at; the
 * desktop alert shows when the tab is hidden or you're elsewhere. Do not disturb silences both (the player checks it
 * for sounds; `dnd` here is for alerts).
 */
export function dmAlert(
  e: Pick<DmEvent, "message" | "status" | "ignored" | "muted" | "conversation_id">,
  o: { meId: string; viewingId: string | null; hidden: boolean; blocked: ReadonlySet<string>; dnd: boolean },
): { sound: boolean; alert: boolean } {
  const quiet = { sound: false, alert: false };
  if (e.message.author_id === o.meId || o.blocked.has(e.message.author_id)) return quiet;
  if (e.status === "left" || (e.status === "request" && e.ignored) || e.muted) return quiet;
  const looking = !o.hidden && o.viewingId === e.conversation_id;
  return { sound: !looking, alert: !o.dnd && (o.hidden || o.viewingId !== e.conversation_id) };
}

/** "New message" selection: toggles a person, refusing more than MAX_GROUP - 1 others (`limit` for adding to a group). */
export function togglePick(selected: string[], id: string, limit = MAX_GROUP - 1): { selected: string[]; full: boolean } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), full: false };
  if (selected.length >= limit) return { selected, full: true };
  return { selected: [...selected, id], full: false };
}

/** The room message shape, so DMs reuse MessageItem and buildRows (no threads, outcomes or community in a DM). */
export function asRoomMessage(m: DmMessage): Message {
  return {
    id: m.id,
    room_id: m.conversation_id,
    community_id: "",
    author_id: m.author_id,
    parent_id: null,
    body: m.body,
    reply_count: 0,
    last_reply_at: null,
    resolved_at: null,
    resolved_by: null,
    outcome: null,
    edited_at: m.edited_at,
    deleted_at: m.deleted_at,
    created_at: m.created_at,
  };
}

/** Insert or replace a message, oldest first. */
export function upsertDm(list: DmMessage[], m: DmMessage): DmMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...list[i], ...m };
    return next;
  }
  const next = [...list, m];
  if (list.length && list[list.length - 1].created_at > m.created_at) next.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return next;
}

export const WHO_CAN_DM: { value: WhoCanDm; label: string; hint: string }[] = [
  { value: "shared_community", label: "People in your communities", hint: "Anyone you share a community with." },
  {
    value: "anyone",
    label: "Anyone on Ctrl Room",
    hint: "People outside your communities can find you by your exact username.",
  },
  { value: "nobody", label: "Nobody", hint: "No new conversations. The ones you already have keep working." },
];
