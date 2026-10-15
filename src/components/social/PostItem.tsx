"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { RichText } from "@/components/chat/RichText";
import { useConfirm } from "@/components/Dialogs";
import { cloudErrorText } from "@/lib/cloudErrors";
import { shortAge, toggledLike, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ReportPostDialog } from "./ReportPostDialog";

/**
 * One post: who wrote it (to their profile), where (a community, if any), when, the text, and Reply, Like and a menu
 * (Delete for your own, Report for others'). Likes apply at once and are undone if the database refuses.
 */
export function PostItem({ post, me, onChange, onDeleted, linkToThread = true }: { post: PostCard; me: { id: string; username: string }; onChange: (p: PostCard) => void; onDeleted: (id: string) => void; linkToThread?: boolean }) {
  const confirm = useConfirm();
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = post.author_id === me.id;
  const profile = { id: post.author_id, username: post.author_username, display_name: post.author_name, avatar_url: post.author_avatar };
  const thread = `/app/feed/post/${post.id}`;

  const like = async () => {
    const next = toggledLike(post);
    onChange(next);
    const sb = supabaseBrowser();
    const { error: err } = next.liked ? await sb.from("post_likes").insert({ post_id: post.id, user_id: me.id }) : await sb.from("post_likes").delete().eq("post_id", post.id).eq("user_id", me.id);
    if (err) {
      onChange(post);
      setError(cloudErrorText(err.message) ?? "Couldn't save that. Try again.");
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete this post?", body: "It's removed for everyone. Replies to it stay.", confirmLabel: "Delete", tone: "danger" }))) return;
    const { error: err } = await supabaseBrowser().rpc("delete_post", { p_post: post.id });
    if (err) return setError(cloudErrorText(err.message) ?? "Couldn't delete it. Try again.");
    onDeleted(post.id);
  };

  return (
    <article className="flex gap-3 border-b border-line px-4 py-3" aria-labelledby={`post-${post.id}-by`}>
      <Link href={`/u/${post.author_username}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <Avatar profile={profile} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <Link id={`post-${post.id}-by`} href={`/u/${post.author_username}`} className="font-semibold hover:underline">
            {post.author_name}
          </Link>
          <span className="text-muted">@{post.author_username}</span>
          <span aria-hidden="true" className="text-muted">·</span>
          <Link href={thread} className="text-muted hover:underline" title={new Date(post.created_at).toLocaleString()}>
            <time dateTime={post.created_at}>{shortAge(post.created_at)}</time>
          </Link>
          {post.edited_at && <span className="text-xs text-muted">(edited)</span>}
        </div>
        {post.community_slug && (
          <Link href={`/c/${post.community_slug}`} className="mt-0.5 inline-block text-xs text-muted hover:text-fg hover:underline">
            in {post.community_name}
          </Link>
        )}
        <p className="mt-1 whitespace-pre-wrap text-[15px] leading-snug [overflow-wrap:anywhere]">
          <RichText body={post.body} myUsername={me.username} />
        </p>
        <div className="mt-2 flex items-center gap-1 text-sm text-muted">
          {linkToThread ? (
            <Link href={thread} className="btn-ghost h-8 px-2" aria-label={`Reply. ${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}`}>
              Reply{post.reply_count > 0 && <span className="ml-1 tabular-nums">{post.reply_count}</span>}
            </Link>
          ) : (
            <span className="px-2">{post.reply_count === 1 ? "1 reply" : `${post.reply_count} replies`}</span>
          )}
          <button type="button" onClick={like} aria-pressed={post.liked} className={`btn-ghost h-8 px-2 ${post.liked ? "text-fg" : ""}`} aria-label={`${post.liked ? "Unlike" : "Like"}. ${post.like_count} ${post.like_count === 1 ? "like" : "likes"}`}>
            {post.liked ? "Liked" : "Like"}
            {post.like_count > 0 && <span className="ml-1 tabular-nums">{post.like_count}</span>}
          </button>
          <span className="ml-auto">
            {mine ? (
              <button type="button" className="btn-ghost h-8 px-2" onClick={remove}>
                Delete
              </button>
            ) : (
              <button type="button" className="btn-ghost h-8 px-2" onClick={() => setReporting(true)}>
                Report
              </button>
            )}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-sm text-alert">
            {error}
          </p>
        )}
      </div>
      {reporting && <ReportPostDialog postId={post.id} author={post.author_name} preview={post.body} onClose={() => setReporting(false)} />}
    </article>
  );
}
