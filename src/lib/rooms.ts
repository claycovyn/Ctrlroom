import type { Role, Room, RoomPin, RoomSection } from "./types";

/** Who can start posts in a room (rooms.post_min_role), in plain words. */
export const POST_ROLE_LABEL: Record<Role, string> = {
  member: "Everyone",
  mod: "Mods and up",
  admin: "Admins and up",
  owner: "Only the owner",
};

/** Rooms and sections sort by position, then name, like the sidebar always has. */
export function byPosition<T extends { position: number; name: string }>(a: T, b: T): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

export interface SidebarLayout {
  /** This person's pins, in the order they pinned them. */
  pinned: Room[];
  /** Unpinned rooms with no section (or whose section is gone), by position. */
  loose: Room[];
  /** Every section by position, with its unpinned rooms by position. `total` counts pinned ones too. */
  sections: { section: RoomSection; rooms: Room[]; total: number }[];
}

/** Pinned (personal, top) → rooms with no section → each section with its rooms. */
export function sidebarLayout(rooms: Room[], sections: RoomSection[], pins: RoomPin[]): SidebarLayout {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const pinned = [...pins]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.room_id.localeCompare(b.room_id)))
    .map((p) => byId.get(p.room_id))
    .filter((r): r is Room => !!r);
  const pinnedIds = new Set(pinned.map((r) => r.id));
  const sectionIds = new Set(sections.map((s) => s.id));
  const sorted = [...rooms].sort(byPosition);
  return {
    pinned,
    loose: sorted.filter((r) => !pinnedIds.has(r.id) && !(r.section_id && sectionIds.has(r.section_id))),
    sections: [...sections].sort(byPosition).map((section) => {
      const inSection = sorted.filter((r) => r.section_id === section.id);
      return { section, rooms: inSection.filter((r) => !pinnedIds.has(r.id)), total: inSection.length };
    }),
  };
}

/** The rooms that share a room's place in the order: same section (or both no section). */
export function siblings(rooms: Room[], sections: RoomSection[], room: Room): Room[] {
  const known = new Set(sections.map((s) => s.id));
  const key = (r: Room) => (r.section_id && known.has(r.section_id) ? r.section_id : null);
  return rooms.filter((r) => key(r) === key(room)).sort(byPosition);
}

/**
 * Moves one item up (-1) or down (+1) in an ordered list and renumbers the list 0..n-1.
 * Returns only the items whose position changed (empty when it can't move).
 */
export function moveInList<T extends { id: string; position: number }>(ordered: T[], id: string, dir: -1 | 1): { id: string; position: number }[] {
  const i = ordered.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ordered.length) return [];
  const next = [...ordered];
  [next[i], next[j]] = [next[j], next[i]];
  return next.flatMap((x, position) => (x.position === position ? [] : [{ id: x.id, position }]));
}

/** Position for something added at the end of a list. */
export function nextPosition(list: { position: number }[]): number {
  return list.reduce((max, x) => Math.max(max, x.position + 1), 0);
}

/** Apply { id, position } changes to a list. */
export function applyPositions<T extends { id: string; position: number }>(list: T[], changes: { id: string; position: number }[]): T[] {
  const map = new Map(changes.map((c) => [c.id, c.position]));
  return list.map((x) => (map.has(x.id) ? { ...x, position: map.get(x.id)! } : x));
}

/** Section ids collapsed in this browser, per community. Storage can be missing or blocked: never throw. */
export function readCollapsed(communityId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`ctrlroom:collapsed:${communityId}`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeCollapsed(communityId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(`ctrlroom:collapsed:${communityId}`, JSON.stringify(ids));
  } catch {
    // private window or blocked storage: collapsing still works until reload
  }
}

/** Apply a community-topic broadcast ('rooms' or 'sections': { op, room|section }) to a list, kept in order. */
export function applyChange<T extends { id: string; position: number; name: string }>(list: T[], op: string, row: T): T[] {
  const rest = list.filter((x) => x.id !== row.id);
  return (op === "delete" ? rest : [...rest, row]).sort(byPosition);
}

/**
 * The server list wins whenever a new payload arrives (router.refresh(), navigating back into the community):
 * a fresh server list replaces what the browser had, unless it's the very same array.
 */
export function syncFromServer<T>(current: T[], previousServer: T[], nextServer: T[]): T[] {
  return nextServer === previousServer ? current : nextServer;
}

/** The rename-a-section prompt (sidebar … menu and Settings → Rooms). */
export function renameSectionDialog(current: string) {
  return {
    title: `Rename ${current}`,
    label: "Section name",
    defaultValue: current,
    maxLength: 48,
    confirmLabel: "Rename",
  };
}
