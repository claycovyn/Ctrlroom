"use client";

import Link from "next/link";
import { Avatar } from "@/components/chat/Avatar";
import { useCommunity } from "@/components/chat/CommunityContext";
import { CheckIcon, HeartIcon, PinIcon, ThreadIcon } from "@/components/chat/icons";
import { sinceLabel } from "@/lib/format";
import { levelFor } from "@/lib/levels";
import type { Category, Post } from "@/lib/types";

export function LikeButton({ count, liked, disabled, onClick, small }: { count: number; liked: boolean; disabled?: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      title={disabled ? "You can’t like your own post" : liked ? "Unlike" : "Like"}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${small ? "text-xs" : "text-sm"} ${
        liked ? "font-medium text-fg" : "text-muted hover:bg-raised hover:text-fg"
      } disabled:cursor-default disabled:hover:bg-transparent`}
    >
      <HeartIcon className={`${small ? "h-3.5 w-3.5" : "h-4 w-4"} ${liked ? "fill-current" : ""}`} />
      {count}
    </button>
  );
}

export function PostCard({ post, category, liked, onLike }: { post: Post; category: Category | undefined; liked: boolean; onLike: () => void }) {
  const { me, community, profiles, points } = useCommunity();
  const author = profiles[post.author_id];
  return (
    <Link href={`/c/${community.slug}/feed/${post.id}`} className="card block p-4 transition-colors hover:border-muted sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <Avatar profile={author} size={36} level={points[post.author_id] !== undefined ? levelFor(points[post.author_id]) : undefined} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{author?.display_name ?? "…"}</div>
          <div className="truncate text-xs text-muted">
            {sinceLabel(post.created_at)}
            {category && (
              <>
                {" "}
                · {category.emoji} {category.name}
              </>
            )}
          </div>
        </div>
        {post.pinned && (
          <span className="inline-flex items-center gap-1 rounded bg-raised px-2 py-0.5 text-xs text-muted">
            <PinIcon className="h-3 w-3" /> Pinned
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold leading-snug">{post.title}</h2>
      {post.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[15px] text-muted">{post.body}</p>}
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <LikeButton count={post.like_count} liked={liked} disabled={post.author_id === me.id} onClick={onLike} />
        <span className="inline-flex items-center gap-1.5 px-2 py-1">
          <ThreadIcon className="h-4 w-4" /> {post.comment_count}
        </span>
        {post.answer_comment_id && (
          <span className="inline-flex items-center gap-1 rounded-full bg-signal px-2 py-0.5 text-xs font-medium text-signal-fg">
            <CheckIcon className="h-3 w-3" /> Answered
          </span>
        )}
        {post.comment_count > 0 && <span className="ml-auto text-xs">Active {sinceLabel(post.last_activity_at)}</span>}
      </div>
    </Link>
  );
}
