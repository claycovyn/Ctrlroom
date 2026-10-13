import { describe, expect, it } from "vitest";
import { isRoomIconId, ROOM_ICON_IDS, ROOM_ICONS, roomIconById, searchRoomIcons, suggestRoomIcon } from "@/lib/roomIcons";

describe("room icon data", () => {
  it("has 46 icons with unique ids the database accepts", () => {
    expect(ROOM_ICONS).toHaveLength(46);
    expect(new Set(ROOM_ICON_IDS).size).toBe(46);
    expect(ROOM_ICONS.map((i) => i.id)).toEqual([...ROOM_ICON_IDS]);
    for (const i of ROOM_ICONS) {
      expect(i.id).toMatch(/^[a-z0-9-]{1,32}$/); // same as the rooms.icon check in 0009_room_icons.sql
      expect(i.label.trim()).not.toBe("");
      expect(i.shapes.length).toBeGreaterThan(0);
    }
  });

  it("shapes are plain path data or circle numbers, never markup", () => {
    for (const i of ROOM_ICONS) {
      for (const s of i.shapes) {
        if ("d" in s) expect(s.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
        else for (const n of [s.cx, s.cy, s.r]) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("unknown or missing ids fall back to no icon", () => {
    expect(roomIconById("lounge")?.label).toBe("Lounge");
    expect(roomIconById(null)).toBeNull();
    expect(roomIconById(undefined)).toBeNull();
    expect(roomIconById("")).toBeNull();
    expect(roomIconById("not-an-icon")).toBeNull();
    expect(roomIconById("__proto__")).toBeNull();
    expect(isRoomIconId("dev")).toBe(true);
    expect(isRoomIconId("toString")).toBe(false);
    expect(isRoomIconId(3)).toBe(false);
  });
});

describe("searchRoomIcons", () => {
  it("returns everything for an empty search", () => {
    expect(searchRoomIcons("  ")).toHaveLength(46);
  });
  it("matches labels case-insensitively, every word", () => {
    expect(searchRoomIcons("MEM").map((i) => i.id)).toEqual(["memes"]);
    expect(searchRoomIcons("stage").map((i) => i.id)).toEqual(["events"]);
    expect(searchRoomIcons("off top").map((i) => i.id)).toEqual(["off-topic"]);
    expect(searchRoomIcons("zzz")).toEqual([]);
  });
});

describe("suggestRoomIcon", () => {
  it.each([
    ["announcements", "announcements"],
    ["Announcements", "announcements"],
    ["dev", "dev"],
    ["build", "dev"],
    ["builds", "dev"],
    ["dev-chat", "dev"],
    ["help", "help"],
    ["help-desk", "help"],
    ["lounge", "lounge"],
    ["floof", "lounge"],
    ["the-floof-zone", "lounge"],
    ["memes", "memes"],
    ["meme", "memes"],
    ["showcase", "showcase"],
    ["voice", "voice"],
    ["Voice chat", "voice"],
    ["off-topic", "off-topic"],
    ["general", "general"],
    ["Café", "lounge"],
    ["bug-reports", "bugs"],
    ["news", "news"],
    ["releases", "releases"],
  ])("%s → %s", (name, id) => {
    expect(suggestRoomIcon(name)).toBe(id);
  });

  it("returns null when nothing fits", () => {
    expect(suggestRoomIcon("")).toBeNull();
    expect(suggestRoomIcon("---")).toBeNull();
    expect(suggestRoomIcon("zebra-crossing")).toBeNull();
    expect(suggestRoomIcon("x")).toBeNull();
  });

  it("only ever suggests a known icon", () => {
    for (const name of ["random", "faq", "hiring", "ios", "wiki", "gym", "recipes"]) {
      const id = suggestRoomIcon(name);
      expect(id && isRoomIconId(id)).toBe(true);
    }
  });
});
