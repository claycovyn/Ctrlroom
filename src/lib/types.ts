export type Role = "owner" | "admin" | "mod" | "member";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_bot?: boolean;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  /** Uploaded community image (0006); shown instead of `icon` when set. */
  icon_url?: string | null;
  /** Uploaded cover photo (0006), a 4:1 banner. */
  cover_url?: string | null;
  is_public: boolean;
  owner_id: string;
  taken_down_at?: string | null;
  taken_down_reason?: string | null;
}

export interface Room {
  id: string;
  community_id: string;
  slug: string;
  name: string;
  topic: string;
  kind: "text" | "voice";
  post_min_role: Role;
  position: number;
}

export interface Message {
  id: string;
  room_id: string;
  community_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  reply_count: number;
  last_reply_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  outcome: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface BoardItem {
  id: string;
  room_id: string;
  kind: "decision" | "link" | "doc" | "note";
  title: string;
  url: string | null;
  body: string;
  message_id: string | null;
  created_by: string;
  created_at: string;
}

export interface Unread {
  room_id: string;
  unread: number;
  mentions: number;
  notify: "all" | "mentions" | "none";
}

export interface CatchUp {
  since: string;
  new_messages: number;
  first_unread_id: string | null;
  people: string[];
  threads: { id: string; preview: string; new_replies: number; outcome: string | null }[];
  decisions: { id: string; title: string }[];
  mentions: number;
}

export interface Member {
  user_id: string;
  role: Role;
  joined_at: string;
}

export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, mod: 2, member: 1 };

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return role ? ROLE_RANK[role] >= ROLE_RANK[min] : false;
}

export interface AgentJob {
  id: string;
  bot: "ctrl" | "openctrl";
  status: "queued" | "running" | "done" | "failed" | "limited";
  step: string;
  message_id: string;
  thread_id: string;
  requested_by: string;
}
