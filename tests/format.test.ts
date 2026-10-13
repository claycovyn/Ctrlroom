import { describe, expect, it } from "vitest";
import { buildRows, dayLabel, keepSameSummaries, mentionsIn, timeLabel, slugify, summarizeReactions, tokenize, upsertMessage } from "@/lib/format";
import type { Message } from "@/lib/types";

const msg = (id: string, author: string, at: string, extra: Partial<Message> = {}): Message => ({
  id,
  room_id: "r",
  community_id: "c",
  author_id: author,
  parent_id: null,
  body: id,
  reply_count: 0,
  last_reply_at: null,
  resolved_at: null,
  resolved_by: null,
  outcome: null,
  edited_at: null,
  deleted_at: null,
  created_at: at,
  ...extra,
});

describe("slugify", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("OpenCtrl Collective!")).toBe("openctrl-collective");
    expect(slugify("  Café — Crew  ")).toBe("cafe-crew");
    expect(slugify("a".repeat(60))).toHaveLength(40);
  });
});

describe("tokenize", () => {
  it("finds mentions, links and code", () => {
    expect(tokenize("hey @Alice see https://x.com/a?b=1. and `npm i`")).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", username: "alice" },
      { type: "text", value: " see " },
      { type: "link", href: "https://x.com/a?b=1" },
      { type: "text", value: ". and " },
      { type: "code", value: "npm i" },
    ]);
  });
  it("ignores emails as mentions", () => {
    expect(mentionsIn("mail me at bob@example.com, @carol")).toEqual(["carol"]);
  });
  it("keeps code blocks verbatim", () => {
    expect(tokenize("look:\n```ts\nconst a = '@x https://y.z';\n```")).toEqual([
      { type: "text", value: "look:\n" },
      { type: "codeblock", value: "const a = '@x https://y.z';" },
    ]);
  });
  it("never produces html", () => {
    const t = tokenize("<img src=x onerror=alert(1)>");
    expect(t).toEqual([{ type: "text", value: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("upsertMessage", () => {
  it("appends, replaces and keeps order", () => {
    let list = [msg("a", "u", "2026-01-01T10:00:00Z")];
    list = upsertMessage(list, msg("c", "u", "2026-01-01T10:02:00Z"));
    list = upsertMessage(list, msg("b", "u", "2026-01-01T10:01:00Z"));
    list = upsertMessage(list, { ...msg("a", "u", "2026-01-01T10:00:00Z"), body: "edited" });
    expect(list.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(list[0].body).toBe("edited");
  });
});

describe("buildRows", () => {
  it("groups consecutive messages from the same author", () => {
    const rows = buildRows(
      [
        msg("1", "u1", "2026-01-01T10:00:00Z"),
        msg("2", "u1", "2026-01-01T10:01:00Z"),
        msg("3", "u2", "2026-01-01T10:02:00Z"),
        msg("4", "u2", "2026-01-01T10:30:00Z"),
      ],
      new Date("2026-01-01T12:00:00Z"),
    );
    expect(rows.map((r) => r.compact)).toEqual([false, true, false, false]);
    expect(rows[0].day).not.toBeNull();
    expect(rows[1].day).toBeNull();
  });
});

describe("dayLabel", () => {
  it("says today / yesterday", () => {
    const now = new Date(2026, 4, 10, 12);
    expect(dayLabel(new Date(2026, 4, 10, 1), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 4, 9, 23), now)).toBe("Yesterday");
  });
});

describe("summarizeReactions", () => {
  it("counts per emoji and marks mine", () => {
    const s = summarizeReactions(
      [
        { message_id: "m", user_id: "me", emoji: "🔥" },
        { message_id: "m", user_id: "you", emoji: "🔥" },
        { message_id: "m", user_id: "you", emoji: "👍" },
      ],
      "me",
    );
    expect(s.get("m")).toEqual([
      { emoji: "🔥", count: 2, mine: true },
      { emoji: "👍", count: 1, mine: false },
    ]);
  });
});

describe("keepSameSummaries", () => {
  it("keeps the old list for messages whose reactions didn't change, and a new one where they did", () => {
    const r1 = [
      { message_id: "a", user_id: "u1", emoji: "👍" },
      { message_id: "b", user_id: "u2", emoji: "🔥" },
    ];
    const prev = summarizeReactions(r1, "u1");
    const next = keepSameSummaries(prev, summarizeReactions([...r1, { message_id: "b", user_id: "u3", emoji: "🔥" }], "u1"));
    expect(next.get("a")).toBe(prev.get("a"));
    expect(next.get("b")).not.toBe(prev.get("b"));
    expect(next.get("b")).toEqual([{ emoji: "🔥", count: 2, mine: false }]);
  });
  it("drops messages that lost every reaction and passes through when there's nothing before", () => {
    const prev = summarizeReactions([{ message_id: "a", user_id: "u1", emoji: "👍" }], "u1");
    expect(keepSameSummaries(prev, summarizeReactions([], "u1")).has("a")).toBe(false);
    const fresh = summarizeReactions([{ message_id: "a", user_id: "u1", emoji: "👍" }], "u1");
    expect(keepSameSummaries(null, fresh)).toBe(fresh);
  });
});

describe("timeLabel", () => {
  it("formats like toLocaleTimeString (hour and minutes), with one shared formatter", () => {
    for (const iso of ["2026-10-13T07:05:00Z", "2026-10-13T19:45:00Z", "2026-01-01T00:00:00Z"]) {
      expect(timeLabel(iso)).toBe(new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    }
  });
});
