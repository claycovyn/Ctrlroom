// The signed-in shell (/app, the Feed, profiles, Communities, Settings): its data shapes and small pure helpers.
import type { Unread } from "./types";

/** You, as the shell needs you: the rail's account button, the Post sheet and the right column. */
export interface ShellMe {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  is_private: boolean;
  public_profile: boolean;
}

/** A community you're in, for the right column, the Communities page and the Post sheet's "Post to". */
export interface ShellCommunity {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  icon_url: string | null;
  is_public: boolean;
  role: "owner" | "admin" | "mod" | "member";
}

/** What's going on in one community, from my_unreads: rooms with new messages and your mentions. */
export interface CommunityActivity {
  rooms: number;
  mentions: number;
}

/** Window events between the shell and the pages. */
export const POST_EVENT = "ctrlroom:post"; // a new post for you (the Feed listens)
export const SEEN_EVENT = "ctrlroom:activity-seen"; // the Activity page read everything
export const POSTED_EVENT = "ctrlroom:posted"; // you posted from the Post sheet (the Feed adds it)

/** Rooms with something new (muted rooms don't count) and your mentions, for one community. */
export function activityOf(unreads: Pick<Unread, "unread" | "mentions" | "notify">[]): CommunityActivity {
  let rooms = 0;
  let mentions = 0;
  for (const u of unreads) {
    mentions += u.mentions;
    if (u.notify !== "none" && (u.unread > 0 || u.mentions > 0)) rooms += 1;
  }
  return { rooms, mentions };
}

/** "2 mentions · 3 rooms active", "1 room active", or "" when it's quiet. */
export function activityLabel(a: CommunityActivity | undefined): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.mentions > 0) parts.push(a.mentions === 1 ? "1 mention" : `${a.mentions > 99 ? "99+" : a.mentions} mentions`);
  if (a.rooms > 0) parts.push(a.rooms === 1 ? "1 room active" : `${a.rooms} rooms active`);
  return parts.join(" · ");
}

/** Across all your communities: rooms with something new, for the right column ("3 rooms active"). */
export function roomsActive(map: Record<string, CommunityActivity>): number {
  return Object.values(map).reduce((n, a) => n + a.rooms, 0);
}

/** People who follow you that you don't follow back (profile_follows rows), newest first, at most `limit`. */
export function followBack<T extends { id: string; relation: string }>(rows: T[], meId: string, limit = 3): T[] {
  return rows.filter((r) => r.id !== meId && r.relation === "none").slice(0, limit);
}

/** Public communities you aren't in yet, at most `limit`. */
export function toExplore<T extends { id: string }>(list: T[], mine: { id: string }[], limit = 3): T[] {
  const have = new Set(mine.map((c) => c.id));
  return list.filter((c) => !have.has(c.id)).slice(0, limit);
}

export type NavKey = "home" | "explore" | "communities" | "messages" | "activity" | "profile" | "settings";

/** Which rail item a path belongs to (the Everyone tab of Home is Explore). */
export function navKeyFor(pathname: string, search: string, username: string): NavKey | null {
  const tab = new URLSearchParams(search).get("tab");
  if (pathname === "/app" || pathname === "/app/feed") return tab === "everyone" ? "explore" : "home";
  if (pathname.startsWith("/app/feed/activity")) return "activity";
  if (pathname.startsWith("/app/feed/")) return "home";
  if (pathname.startsWith("/app/communities")) return "communities";
  if (pathname.startsWith("/app/dm")) return "messages";
  if (pathname.startsWith("/app/settings")) return "settings";
  if (pathname === `/u/${username}` || pathname.startsWith(`/u/${username}/`)) return "profile";
  return null;
}

/** Display names: 1 to 64 characters after trimming (profiles.display_name check). */
export function displayNameProblem(v: string): string | null {
  const t = v.trim();
  if (!t) return "Your name can't be empty.";
  if (t.length > 64) return "Keep it to 64 characters.";
  return null;
}
