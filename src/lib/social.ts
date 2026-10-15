// Posts and follows (supabase/migrations/0020_social.sql, 0021): the shapes the app reads, and small pure helpers.
import type { PostMediaItem } from "./postMedia";

export const POST_MAX = 500;
export const BIO_MAX = 160;
export const FEED_PAGE = 30;

/** A row of the post_cards view (only posts the caller may read). */
export interface PostCard {
  id: string;
  author_id: string;
  community_id: string | null;
  reply_to: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_username: string;
  author_name: string;
  author_avatar: string | null;
  author_is_bot: boolean;
  community_slug: string | null;
  community_name: string | null;
  community_icon: string | null;
  like_count: number;
  reply_count: number;
  liked: boolean;
  /** Photos and videos, in order (0021). */
  media: PostMediaItem[];
}

/** profile_view(): a profile the caller may see, its counts, and where the caller stands with it. */
export interface ProfileView {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  is_private: boolean;
  is_bot: boolean;
  public_profile: boolean;
  created_at: string;
  followers: number;
  following: number;
  /** Null when the caller can't see their posts. */
  posts: number | null;
  relation: "self" | "none" | "pending" | "active";
  follows_you: boolean;
  you_blocked: boolean;
  can_see_posts: boolean;
}

export type FeedScope = "following" | "everyone";
export const isFeedScope = (v: unknown): v is FeedScope => v === "following" || v === "everyone";

/** "now", "5m", "3h", "2d", then a date ("Mar 4", or "Mar 4, 2025" in another year). */
export function shortAge(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** "1 follower", "2,300 followers". */
export function countLabel(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Characters left in a post, counted the way the database does (trimmed). */
export function charsLeft(body: string, max = POST_MAX): number {
  return max - body.trim().length;
}

/** A list with this post put in place of the one with the same id (likes, edits), or the list unchanged. */
export function replacePost(list: PostCard[], next: PostCard): PostCard[] {
  return list.map((p) => (p.id === next.id ? next : p));
}

/** Liking or unliking, applied at once in the list (the database follows). */
export function toggledLike(p: PostCard): PostCard {
  return { ...p, liked: !p.liked, like_count: Math.max(0, p.like_count + (p.liked ? -1 : 1)) };
}

/** Pages of a feed, without duplicates (a post can arrive twice when new ones were added between pages). */
export function mergePosts(list: PostCard[], more: PostCard[]): PostCard[] {
  const seen = new Set(list.map((p) => p.id));
  return [...list, ...more.filter((p) => !seen.has(p.id))];
}
