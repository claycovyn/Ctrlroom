export type Role = "owner" | "admin" | "mod" | "member";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  is_public: boolean;
  owner_id: string;
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

export interface Category {
  id: string;
  community_id: string;
  name: string;
  emoji: string;
  position: number;
  post_min_role: Role;
  answers: boolean;
}

export interface Post {
  id: string;
  community_id: string;
  category_id: string | null;
  author_id: string;
  title: string;
  body: string;
  pinned: boolean;
  like_count: number;
  comment_count: number;
  answer_comment_id: string | null;
  last_activity_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  community_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface CourseCard {
  id: string;
  title: string;
  description: string;
  emoji: string;
  published: boolean;
  unlock_level: number;
  lesson_count: number;
  done_count: number;
  locked: boolean;
}

export interface Course {
  id: string;
  community_id: string;
  title: string;
  description: string;
  emoji: string;
  position: number;
  unlock_level: number;
  published: boolean;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  position: number;
}

export interface LessonRow {
  id: string;
  module_id: string;
  title: string;
  position: number;
  drip_days: number;
  done: boolean;
  locked: boolean;
  opens_at: string;
}

export interface LessonContent {
  lesson_id: string;
  body: string;
  video_url: string | null;
}

export interface CalendarEvent {
  id: string;
  community_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  room_id: string | null;
  location_url: string | null;
  created_by: string;
}

export type RsvpStatus = "going" | "maybe" | "no";

export interface AppNotification {
  id: string;
  community_id: string;
  kind: "comment" | "reply" | "mention" | "answer";
  actor_id: string | null;
  actor?: string;
  post_id: string | null;
  comment_id: string | null;
  preview: string;
  read_at: string | null;
  created_at: string;
}

export interface Standing {
  points: number;
  level: number;
  level_floor: number;
  next_level_at: number | null;
  week_points: number;
  levels: { level: number; members: number }[];
}
