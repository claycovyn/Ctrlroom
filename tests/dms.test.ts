import { describe, expect, it } from "vitest";
import {
  applyIncoming,
  asRoomMessage,
  badgeCount,
  badgeLabel,
  conversationName,
  dmAlert,
  markRead,
  MAX_GROUP,
  previewText,
  requestState,
  sortInbox,
  splitInbox,
  togglePick,
  upsertDm,
  type DmConversation,
  type DmEvent,
  type DmMember,
  type DmMessage,
} from "@/lib/dms";

const ME = "me";
const member = (id: string, name: string, status: DmMember["status"] = "active"): DmMember => ({
  user_id: id,
  username: id,
  display_name: name,
  avatar_url: null,
  status,
});
const conv = (id: string, extra: Partial<DmConversation> = {}): DmConversation => ({
  id,
  is_group: false,
  title: null,
  created_by: "maya",
  created_at: "2026-10-01T10:00:00Z",
  last_message_at: null,
  status: "active",
  ignored: false,
  muted: false,
  last_read_at: "2026-10-01T10:00:00Z",
  unread: 0,
  last_message: null,
  members: [member(ME, "Me Myself"), member("maya", "Maya Ortiz")],
  ...extra,
});
const msg = (id: string, author: string, at: string, extra: Partial<DmMessage> = {}): DmMessage => ({
  id,
  conversation_id: "c1",
  author_id: author,
  body: `body ${id}`,
  edited_at: null,
  deleted_at: null,
  created_at: at,
  ...extra,
});
const event = (m: DmMessage, extra: Partial<DmEvent> = {}): DmEvent => ({
  message: m,
  conversation_id: m.conversation_id,
  is_group: false,
  status: "active",
  ignored: false,
  muted: false,
  author: "Maya Ortiz",
  ...extra,
});

describe("request state", () => {
  it("puts each conversation in one place", () => {
    expect(requestState({ status: "active", ignored: false })).toBe("chat");
    expect(requestState({ status: "request", ignored: false })).toBe("request");
    expect(requestState({ status: "request", ignored: true })).toBe("ignored");
    expect(requestState({ status: "left", ignored: false })).toBe("left");
  });

  it("splits the inbox into chats, requests and ignored, newest first", () => {
    const list = [
      conv("old", { last_message_at: "2026-10-02T00:00:00Z" }),
      conv("req", { status: "request", last_message_at: "2026-10-03T00:00:00Z" }),
      conv("new", { last_message_at: "2026-10-04T00:00:00Z" }),
      conv("ign", { status: "request", ignored: true }),
      conv("gone", { status: "left" }),
    ];
    const { chats, requests, ignored } = splitInbox(list);
    expect(chats.map((c) => c.id)).toEqual(["new", "old"]);
    expect(requests.map((c) => c.id)).toEqual(["req"]);
    expect(ignored.map((c) => c.id)).toEqual(["ign"]);
  });
});

describe("sorting", () => {
  it("orders by the last message, then last activity, then creation, with a stable tie-break", () => {
    const list = [
      conv("b", { created_at: "2026-10-05T00:00:00Z" }),
      conv("a", { created_at: "2026-10-05T00:00:00Z" }),
      conv("m", { last_message: { id: "x", author_id: ME, body: "hi", created_at: "2026-10-06T00:00:00Z", deleted: false } }),
      conv("z", { last_message_at: "2026-09-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(sortInbox(list).map((c) => c.id)).toEqual(["m", "a", "b", "z"]);
    expect(list.map((c) => c.id)).toEqual(["b", "a", "m", "z"]);
  });
});

describe("unread badge", () => {
  it("counts unread in unmuted chats plus one per open request; never ignored or muted", () => {
    const list = [
      conv("a", { unread: 3 }),
      conv("b", { unread: 5, muted: true }),
      conv("c", { status: "request", unread: 9 }),
      conv("d", { status: "request", ignored: true, unread: 4 }),
      conv("e", { status: "left", unread: 2 }),
    ];
    expect(badgeCount(list)).toBe(4);
    expect(badgeCount([])).toBe(0);
  });

  it("caps the label", () => {
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(100)).toBe("99+");
  });
});

describe("incoming messages", () => {
  const list = [conv("c1", { unread: 1 }), conv("c2")];

  it("adds to unread and updates the preview", () => {
    const next = applyIncoming(list, event(msg("m1", "maya", "2026-10-07T00:00:00Z")), ME, null)!;
    expect(next[0]).toMatchObject({ unread: 2, last_message: { id: "m1", body: "body m1" }, last_message_at: "2026-10-07T00:00:00Z" });
    expect(next[1]).toBe(list[1]);
  });

  it("doesn't count your own messages or the conversation you're looking at", () => {
    expect(applyIncoming(list, event(msg("m2", ME, "2026-10-07T00:00:00Z")), ME, null)![0].unread).toBe(0);
    expect(applyIncoming(list, event(msg("m3", "maya", "2026-10-07T00:00:00Z")), ME, "c1")![0].unread).toBe(0);
  });

  it("takes the recipient's state from the event (accepted, ignored, muted)", () => {
    const next = applyIncoming(list, event(msg("m4", "maya", "2026-10-07T00:00:00Z"), { status: "request", ignored: true, muted: true }), ME, null)!;
    expect(next[0]).toMatchObject({ status: "request", ignored: true, muted: true });
  });

  it("asks for a refetch when the conversation is new", () => {
    expect(applyIncoming(list, event(msg("m5", "maya", "2026-10-07T00:00:00Z", { conversation_id: "new" })), ME, null)).toBeNull();
  });

  it("ignores a repeat of the same message and keeps a newer preview", () => {
    const once = applyIncoming(list, event(msg("m6", "maya", "2026-10-07T00:00:00Z")), ME, null)!;
    expect(applyIncoming(once, event(msg("m6", "maya", "2026-10-07T00:00:00Z")), ME, null)).toBe(once);
    const older = applyIncoming(once, event(msg("m0", "maya", "2026-10-06T00:00:00Z")), ME, null)!;
    expect(older[0].last_message?.id).toBe("m6");
  });

  it("clears unread when read", () => {
    expect(markRead([conv("c1", { unread: 4 })], "c1", "2026-10-08T00:00:00Z")[0]).toMatchObject({ unread: 0, last_read_at: "2026-10-08T00:00:00Z" });
  });
});

describe("alerts", () => {
  const base = { meId: ME, viewingId: null, hidden: false, blocked: new Set<string>(), dnd: false };
  const m = msg("m", "maya", "2026-10-07T00:00:00Z");

  it("sounds and alerts for a new message elsewhere", () => {
    expect(dmAlert(event(m), base)).toEqual({ sound: true, alert: true });
  });
  it("stays quiet for your own, blocked, ignored, muted or left", () => {
    const quiet = { sound: false, alert: false };
    expect(dmAlert(event(msg("x", ME, m.created_at)), base)).toEqual(quiet);
    expect(dmAlert(event(m), { ...base, blocked: new Set(["maya"]) })).toEqual(quiet);
    expect(dmAlert(event(m, { status: "request", ignored: true }), base)).toEqual(quiet);
    expect(dmAlert(event(m, { muted: true }), base)).toEqual(quiet);
    expect(dmAlert(event(m, { status: "left" }), base)).toEqual(quiet);
  });
  it("a new request still notifies", () => {
    expect(dmAlert(event(m, { status: "request" }), base)).toEqual({ sound: true, alert: true });
  });
  it("no sound or alert in the conversation you're looking at; both when the tab is hidden", () => {
    expect(dmAlert(event(m), { ...base, viewingId: "c1" })).toEqual({ sound: false, alert: false });
    expect(dmAlert(event(m), { ...base, viewingId: "c1", hidden: true })).toEqual({ sound: true, alert: true });
  });
  it("do not disturb stops the desktop alert", () => {
    expect(dmAlert(event(m), { ...base, dnd: true }).alert).toBe(false);
  });
});

describe("names and previews", () => {
  const group = conv("g", {
    is_group: true,
    members: [member(ME, "Me"), member("maya", "Maya Ortiz"), member("sam", "Sam Lee"), member("ana", "Ana Ruiz"), member("leo", "Leo Park", "left")],
  });
  it("names 1:1s after the other person and groups after their title or people", () => {
    expect(conversationName(conv("a"), ME)).toBe("Maya Ortiz");
    expect(conversationName(group, ME)).toBe("Maya Ortiz, Sam Lee and 1 other");
    expect(conversationName({ ...group, members: group.members.slice(0, 3) }, ME)).toBe("Maya Ortiz and Sam Lee");
    expect(conversationName({ ...group, title: "Launch" }, ME)).toBe("Launch");
  });
  it("previews say who wrote it", () => {
    const last = (author: string, extra = {}) => ({ id: "x", author_id: author, body: "see  you\nsoon", created_at: "2026-10-07T00:00:00Z", deleted: false, ...extra });
    expect(previewText(conv("a", { last_message: last(ME) }), ME)).toBe("You: see you soon");
    expect(previewText(conv("a", { last_message: last("maya") }), ME)).toBe("see you soon");
    expect(previewText({ ...group, last_message: last("sam") }, ME)).toBe("Sam: see you soon");
    expect(previewText(conv("a", { last_message: last("maya", { deleted: true }) }), ME)).toBe("Message removed");
    expect(previewText(conv("a"), ME)).toBe("No messages yet");
  });
});

describe("picking people", () => {
  it("toggles and stops at the group cap", () => {
    let picked: string[] = [];
    for (let i = 0; i < MAX_GROUP - 1; i++) picked = togglePick(picked, `p${i}`).selected;
    expect(picked).toHaveLength(9);
    expect(togglePick(picked, "one-more")).toEqual({ selected: picked, full: true });
    expect(togglePick(picked, "p0").selected).toHaveLength(8);
    expect(togglePick(["a"], "b", 1)).toEqual({ selected: ["a"], full: true });
  });
});

describe("messages", () => {
  it("keep order on insert and replace in place", () => {
    let list = [msg("1", "maya", "2026-10-07T00:00:01Z"), msg("3", "maya", "2026-10-07T00:00:03Z")];
    list = upsertDm(list, msg("2", "maya", "2026-10-07T00:00:02Z"));
    expect(list.map((m) => m.id)).toEqual(["1", "2", "3"]);
    list = upsertDm(list, { ...list[1], body: "", deleted_at: "2026-10-07T00:01:00Z" });
    expect(list[1]).toMatchObject({ id: "2", body: "", deleted_at: "2026-10-07T00:01:00Z" });
  });
  it("map to the room message shape for MessageItem", () => {
    expect(asRoomMessage(msg("1", "maya", "2026-10-07T00:00:01Z"))).toMatchObject({ id: "1", room_id: "c1", parent_id: null, reply_count: 0, outcome: null });
  });
});
