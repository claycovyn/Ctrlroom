/* eslint-disable @typescript-eslint/no-explicit-any */
// QA harness: the social side for the shell (Home, profiles, Activity, Communities, Settings). Demo people from
// ./data.ts; every post is an example. Deterministic, like the rest of the harness data.
import type { ActivityItem } from "@/components/social/ActivityView";
import type { ShellCommunity, ShellMe } from "@/lib/shell";
import type { PostCard, ProfileView } from "@/lib/social";
import { communities, me as meProfile, profiles } from "./data";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const by = (u: string) => profiles.find((p) => p.username === u)!;

export const shellMe: ShellMe = {
  id: meProfile.id,
  username: meProfile.username,
  display_name: meProfile.display_name,
  avatar_url: null,
  bio: "Runs Night Shift. Building in public, one room at a time.",
  is_private: false,
  public_profile: true,
};

export const shellCommunities: ShellCommunity[] = communities.map((c, i) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  icon: c.icon,
  icon_url: c.icon_url ?? null,
  is_public: c.is_public,
  role: i === 0 ? "owner" : "member",
}));

/** Public communities the demo account isn't in (Communities to explore). */
export const exploreCommunities = [
  { id: "d0000000-0000-4000-8000-000000000011", slug: "indie-makers", name: "Indie Makers", description: "Ship small things, often.", icon: "I", icon_url: null, is_public: true, owner_id: profiles[7].id, taken_down_at: null, created_at: ago(300) },
  { id: "d0000000-0000-4000-8000-000000000012", slug: "film-nights", name: "Film Nights", description: "A movie every Friday, talk after.", icon: "F", icon_url: null, is_public: true, owner_id: profiles[9].id, taken_down_at: null, created_at: ago(900) },
  { id: "d0000000-0000-4000-8000-000000000013", slug: "trail-runners", name: "Trail Runners", description: "Routes, gear and Sunday long runs.", icon: "T", icon_url: null, is_public: true, owner_id: profiles[11].id, taken_down_at: null, created_at: ago(2000) },
];

let pn = 0;
function post(author: string, minutes: number, body: string, extra: Partial<PostCard> = {}): PostCard {
  const a = by(author);
  pn += 1;
  const c = extra.community_id ? communities.find((x) => x.id === extra.community_id) : null;
  return {
    id: `70000000-0000-4000-8000-${String(pn).padStart(12, "0")}`,
    author_id: a.id,
    community_id: null,
    reply_to: null,
    body,
    created_at: ago(minutes),
    edited_at: null,
    author_username: a.username,
    author_name: a.display_name,
    author_avatar: null,
    author_is_bot: false,
    community_slug: c?.slug ?? null,
    community_name: c?.name ?? null,
    community_icon: c?.icon ?? null,
    like_count: 0,
    reply_count: 0,
    liked: false,
    media: [],
    ...extra,
  };
}

const design = communities[1].id;
const oss = communities[2].id;

export const posts: PostCard[] = [
  post("ana", 6, "Critique night is on. Drop your work-in-progress in #critique and we'll go through it on the studio call at 8.", { community_id: design, like_count: 24, reply_count: 7, liked: true }),
  post("maya", 18, "Moved our weekly planning out of a doc and into a thread with an outcome. The decision now sits on the room's board instead of getting lost. Small thing, big difference."),
  post("tomas", 41, "First contributor call went well. Notes and the good-first-issue list: https://example.com/meetup-notes", { community_id: oss, like_count: 12, reply_count: 3 }),
  post("sam", 75, "New cover and icon for the Design Club community. Thanks to everyone who voted in #general.", {
    community_id: design,
    like_count: 31,
    reply_count: 5,
    media: [
      { id: "m1", path: "post/demo/img-2.png", mime: "image/png", width: 1200, height: 630, alt: "The new community cover" },
    ],
  }),
  post("priya", 130, "Quiet by default is underrated. I only get pinged when someone actually needs me.", { like_count: 9, reply_count: 1 }),
  post("leo", 190, "Voice lounge is open if anyone wants to pair on the release checklist tonight.", { community_id: oss, like_count: 4 }),
  post("alex", 260, "Night Shift turned one today. Thanks for building this room with me.", { like_count: 58, reply_count: 14 }),
  post("iris", 420, "Reading list for the month is pinned in #books. Three short ones, one long one.", { like_count: 7, reply_count: 2 }),
  post("noor", 600, "Tried the desktop app on Linux. Same account, own window, notifications work.", { like_count: 15, reply_count: 4 }),
];

/** The Following tab: people the demo account follows and its communities. */
const followingIds = new Set(["maya", "ana", "sam", "tomas", "priya", "leo", "alex"].map((u) => by(u).id));
export const following = [...followingIds];
export function feed(scope: string): PostCard[] {
  return scope === "everyone" ? posts : posts.filter((p) => followingIds.has(p.author_id) || (p.community_id && communities.some((c) => c.id === p.community_id)));
}

export const activity: ActivityItem[] = [
  { kind: "like", at: ago(4), actor_id: by("ana").id, actor_username: "ana", actor_name: by("ana").display_name, actor_avatar: null, post_id: posts[6].id, excerpt: posts[6].body },
  { kind: "follow", at: ago(22), actor_id: by("jonah").id, actor_username: "jonah", actor_name: by("jonah").display_name, actor_avatar: null, post_id: null, excerpt: null },
  { kind: "reply", at: ago(48), actor_id: by("maya").id, actor_username: "maya", actor_name: by("maya").display_name, actor_avatar: null, post_id: posts[6].id, excerpt: "Happy birthday, Night Shift. Best room on the internet." },
  { kind: "follow", at: ago(95), actor_id: by("grace").id, actor_username: "grace", actor_name: by("grace").display_name, actor_avatar: null, post_id: null, excerpt: null },
  { kind: "like", at: ago(180), actor_id: by("leo").id, actor_username: "leo", actor_name: by("leo").display_name, actor_avatar: null, post_id: posts[6].id, excerpt: posts[6].body },
];

/** People who follow the demo account (two it doesn't follow back). */
export const followers = [
  { id: by("jonah").id, username: "jonah", display_name: by("jonah").display_name, avatar_url: null, bio: "", followed_at: ago(22), relation: "none" },
  { id: by("grace").id, username: "grace", display_name: by("grace").display_name, avatar_url: null, bio: "", followed_at: ago(95), relation: "none" },
  { id: by("maya").id, username: "maya", display_name: by("maya").display_name, avatar_url: null, bio: "", followed_at: ago(900), relation: "active" },
];

const BIOS: Record<string, string> = {
  alex: shellMe.bio,
  ana: "Designer. Runs critique night in Design Club.",
  maya: "Product at a small studio. Threads with outcomes, always.",
};

export function profileView(username: string): ProfileView | null {
  const p = profiles.find((x) => x.username === username);
  if (!p) return null;
  const self = p.id === meProfile.id;
  const mine = posts.filter((x) => x.author_id === p.id);
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    avatar_url: null,
    bio: BIOS[p.username] ?? "",
    is_private: false,
    is_bot: !!p.is_bot,
    public_profile: true,
    created_at: "2025-10-02T12:00:00Z",
    followers: self ? 214 : 96,
    following: self ? 87 : 41,
    posts: mine.length,
    relation: self ? "self" : followingIds.has(p.id) ? "active" : "none",
    follows_you: !self && (p.username === "maya" || p.username === "jonah"),
    you_blocked: false,
    can_see_posts: true,
  };
}

export const linkPreview = { title: "Contributor call: notes and first issues", description: "What we covered, who's picking up what, and a list of good first issues.", site: "example.com", image: null };

export function unreadsFor(communityId: string, all: any[]): any[] {
  if (communityId === communities[0].id) return all;
  if (communityId === communities[1].id) return [{ room_id: "x", unread: 4, mentions: 1, notify: "mentions" }];
  return [];
}
