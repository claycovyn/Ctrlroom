import { describe, expect, it } from "vitest";
import { applyPositions, moveInList, nextPosition, siblings, sidebarLayout } from "@/lib/rooms";
import type { Room, RoomSection } from "@/lib/types";

const room = (id: string, position: number, extra: Partial<Room> = {}): Room => ({
  id,
  community_id: "c",
  slug: id,
  name: id,
  topic: "",
  description: "",
  kind: "text",
  post_min_role: "member",
  position,
  section_id: null,
  ...extra,
});
const section = (id: string, position: number): RoomSection => ({ id, community_id: "c", name: id, position });

describe("sidebarLayout", () => {
  const rooms = [
    room("general", 1),
    room("news", 0),
    room("design", 1, { section_id: "work" }),
    room("eng", 0, { section_id: "work" }),
    room("games", 0, { section_id: "fun" }),
    room("orphan", 5, { section_id: "deleted" }),
  ];
  const sections = [section("fun", 1), section("work", 0), section("empty", 2)];

  it("puts pins first in pin order and keeps the rest in position order", () => {
    const l = sidebarLayout(rooms, sections, [
      { room_id: "games", created_at: "2026-01-02T00:00:00Z" },
      { room_id: "general", created_at: "2026-01-01T00:00:00Z" },
      { room_id: "gone", created_at: "2026-01-03T00:00:00Z" },
    ]);
    expect(l.pinned.map((r) => r.id)).toEqual(["general", "games"]);
    expect(l.loose.map((r) => r.id)).toEqual(["news", "orphan"]);
    expect(l.sections.map((s) => [s.section.id, s.rooms.map((r) => r.id), s.total])).toEqual([
      ["work", ["eng", "design"], 2],
      ["fun", [], 1],
      ["empty", [], 0],
    ]);
  });

  it("with no pins everything stays in place", () => {
    const l = sidebarLayout(rooms, sections, []);
    expect(l.pinned).toEqual([]);
    expect(l.loose.map((r) => r.id)).toEqual(["news", "general", "orphan"]);
  });

  it("finds a room's siblings", () => {
    expect(siblings(rooms, sections, rooms[2]).map((r) => r.id)).toEqual(["eng", "design"]);
    expect(siblings(rooms, sections, rooms[0]).map((r) => r.id)).toEqual(["news", "general", "orphan"]);
  });
});

describe("moveInList", () => {
  const list = [room("a", 0), room("b", 1), room("c", 5)];
  it("swaps with the neighbour and renumbers", () => {
    expect(moveInList(list, "c", -1)).toEqual([
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
    expect(moveInList(list, "a", 1)).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
      { id: "c", position: 2 },
    ]);
  });
  it("does nothing at the ends", () => {
    expect(moveInList(list, "a", -1)).toEqual([]);
    expect(moveInList(list, "c", 1)).toEqual([]);
    expect(moveInList(list, "zz", 1)).toEqual([]);
  });
  it("applies positions and finds the next one", () => {
    expect(applyPositions(list, [{ id: "c", position: 1 }]).map((r) => r.position)).toEqual([0, 1, 1]);
    expect(nextPosition(list)).toBe(6);
    expect(nextPosition([])).toBe(0);
  });
});

describe("live and server sync", () => {
  it("applies broadcast changes in order", async () => {
    const { applyChange } = await import("@/lib/rooms");
    const list = [room("a", 0), room("b", 1)];
    expect(applyChange(list, "insert", room("c", 0)).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(applyChange(list, "update", room("a", 2, { name: "a" })).map((r) => r.id)).toEqual(["b", "a"]);
    expect(applyChange(list, "delete", room("a", 0)).map((r) => r.id)).toEqual(["b"]);
  });

  it("a fresh server list replaces a stale browser list", async () => {
    const { syncFromServer } = await import("@/lib/rooms");
    const stale = [room("a", 0)];
    const local = [room("a", 0), room("optimistic", 1)];
    const fresh = [room("a", 0), room("b", 1), room("c", 2)];
    expect(syncFromServer(local, stale, fresh)).toBe(fresh);
    expect(syncFromServer(local, stale, stale)).toBe(local);
  });
});
