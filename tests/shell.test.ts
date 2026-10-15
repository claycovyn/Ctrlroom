import { describe, expect, it } from "vitest";
import { activityLabel, activityOf, displayNameProblem, followBack, navKeyFor, roomsActive, toExplore } from "@/lib/shell";

describe("activityOf", () => {
  it("counts rooms with something new and sums mentions", () => {
    expect(
      activityOf([
        { unread: 3, mentions: 0, notify: "mentions" },
        { unread: 0, mentions: 2, notify: "mentions" },
        { unread: 0, mentions: 0, notify: "all" },
      ]),
    ).toEqual({ rooms: 2, mentions: 2 });
  });
  it("leaves muted rooms out of the room count", () => {
    expect(activityOf([{ unread: 9, mentions: 0, notify: "none" }])).toEqual({ rooms: 0, mentions: 0 });
  });
  it("is quiet with no rooms", () => {
    expect(activityOf([])).toEqual({ rooms: 0, mentions: 0 });
  });
});

describe("activityLabel", () => {
  it("says mentions first, then active rooms", () => {
    expect(activityLabel({ rooms: 3, mentions: 1 })).toBe("1 mention · 3 rooms active");
    expect(activityLabel({ rooms: 1, mentions: 0 })).toBe("1 room active");
    expect(activityLabel({ rooms: 0, mentions: 140 })).toBe("99+ mentions");
  });
  it("is empty when quiet or unknown", () => {
    expect(activityLabel({ rooms: 0, mentions: 0 })).toBe("");
    expect(activityLabel(undefined)).toBe("");
  });
});

describe("roomsActive", () => {
  it("adds up active rooms across communities", () => {
    expect(roomsActive({ a: { rooms: 2, mentions: 0 }, b: { rooms: 1, mentions: 4 }, c: { rooms: 0, mentions: 0 } })).toBe(3);
  });
});

describe("followBack", () => {
  const rows = [
    { id: "me", relation: "self" },
    { id: "a", relation: "none" },
    { id: "b", relation: "active" },
    { id: "c", relation: "pending" },
    { id: "d", relation: "none" },
    { id: "e", relation: "none" },
    { id: "f", relation: "none" },
  ];
  it("keeps only followers you don't follow or haven't asked to follow", () => {
    expect(followBack(rows, "me").map((r) => r.id)).toEqual(["a", "d", "e"]);
    expect(followBack(rows, "me", 10).map((r) => r.id)).toEqual(["a", "d", "e", "f"]);
  });
});

describe("toExplore", () => {
  it("drops communities you're already in", () => {
    expect(toExplore([{ id: "1" }, { id: "2" }, { id: "3" }], [{ id: "2" }], 5).map((c) => c.id)).toEqual(["1", "3"]);
  });
});

describe("navKeyFor", () => {
  it("maps the shell's pages to rail items", () => {
    expect(navKeyFor("/app", "", "clay")).toBe("home");
    expect(navKeyFor("/app", "tab=everyone", "clay")).toBe("explore");
    expect(navKeyFor("/app/feed/post/1", "", "clay")).toBe("home");
    expect(navKeyFor("/app/feed/activity", "", "clay")).toBe("activity");
    expect(navKeyFor("/app/communities", "", "clay")).toBe("communities");
    expect(navKeyFor("/app/settings", "", "clay")).toBe("settings");
    expect(navKeyFor("/u/clay", "", "clay")).toBe("profile");
    expect(navKeyFor("/u/clay/followers", "", "clay")).toBe("profile");
  });
  it("leaves other people's profiles unselected", () => {
    expect(navKeyFor("/u/clayton", "", "clay")).toBe(null);
    expect(navKeyFor("/u/ana", "", "clay")).toBe(null);
  });
});

describe("displayNameProblem", () => {
  it("needs 1 to 64 characters after trimming", () => {
    expect(displayNameProblem("  ")).not.toBeNull();
    expect(displayNameProblem("x".repeat(65))).not.toBeNull();
    expect(displayNameProblem(" Ana ")).toBeNull();
  });
});
