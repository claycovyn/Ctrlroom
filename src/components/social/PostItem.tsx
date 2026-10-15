"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { FlagIcon, HeartIcon, ReplyIcon, TrashIcon } from "@/components/chat/icons";
import { RichText } from "@/components/chat/RichText";
import { CommunityIcon } from "@/components/CommunityMedia";
import { useConfirm } from "@/components/Dialogs";
import { cloudErrorText } from "@/lib/cloudErrors";
import { shortAge, toggledLike, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { firstLink } from "@/lib/postMedia";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { PostMedia } from "./PostMedia";
import { ReportPostDialog } from "./ReportPostDialog";

/**
 * One post: the community it was posted in (if any, above, like a room's name over a message), who wrote it (to their
 * profile), when, the text and media, then Reply, Like and Delete (your own) or Report (others'). Likes apply at once
 * and are undone if the database refuses.
 */
export function PostItem({ post, me, onChange, onDeleted, linkToThread = true }: { post: PostCard; me: { id: string; username: string }; onChange: (p: PostCard) => void; onDeleted: (id: string) => void; linkToThread?: boolean }) {
  const confirm = useConfirm();
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = post.author_id === me.id;
  const profile = { id: post.author_id, username: post.author_username, display_name: post.author_name, avatar_url: post.author_avatar };
  const thread = `/app/feed/post/${post.id}`;
  const link = firstLink(post.body);

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

  const action = "inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] tabular-nums text-muted transition-colors hover:bg-raised hover:text-fg";

  return (
    <article className="border-b border-line px-4 pb-2 pt-3 transition-colors hover:bg-raised/25" aria-labelledby={`post-${post.id}-by`}>
      {post.community_slug && (
        <Link
          href={`/app/feed/c/${post.community_slug}`}
          className="mb-1.5 ml-[52px] flex w-fit max-w-[calc(100%-52px)] items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-fg"
        >
          <CommunityIcon community={{ name: post.community_name ?? "", icon: post.community_icon ?? "" }} className="h-4 w-4 rounded bg-raised text-[9px] ring-1 ring-line" />
          <span className="truncate">
            <span className="sr-only">Posted in </span>
            {post.community_name}
          </span>
        </Link>
      )}
      <div className="flex gap-3">
        <Link href={`/u/${post.author_username}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
          <Avatar profile={profile} size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-1.5 text-[15px] leading-5">
            <Link id={`post-${post.id}-by`} href={`/u/${post.author_username}`} className="truncate font-semibold hover:underline">
              {post.author_name}
            </Link>
            <span className="truncate text-muted">@{post.author_username}</span>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <Link href={thread} className="shrink-0 text-muted hover:underline" title={new Date(post.created_at).toLocaleString()}>
              <time dateTime={post.created_at}>{shortAge(post.created_at)}</time>
            </Link>
            {post.edited_at && <span className="shrink-0 text-xs text-muted">(edited)</span>}
          </div>
          {post.body && (
            <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[1.45] [overflow-wrap:anywhere]">
              <RichText body={post.body} myUsername={me.username} />
            </p>
          )}
          <PostMedia media={post.media ?? []} />
          {!post.media?.length && link && <LinkPreviewCard url={link} />}
          <div className="-ml-2 mt-1.5 flex items-center gap-6">
            {linkToThread ? (
              <Link href={thread} className={action} aria-label={`Reply. ${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}`}>
                <ReplyIcon className="h-[17px] w-[17px]" />
                {post.reply_count > 0 && <span>{post.reply_count}</span>}
              </Link>
            ) : (
              <span className="px-2 text-[13px] text-muted">{post.reply_count === 1 ? "1 reply" : `${post.reply_count} replies`}</span>
            )}
            <button
              type="button"
              onClick={like}
              aria-pressed={post.liked}
              className={`${action} ${post.liked ? "text-fg" : ""}`}
              aria-label={`${post.liked ? "Unlike" : "Like"}. ${post.like_count} ${post.like_count === 1 ? "like" : "likes"}`}
            >
              <HeartIcon className={`h-[17px] w-[17px] ${post.liked ? "fill-current" : ""}`} />
              {post.like_count > 0 && <span>{post.like_count}</span>}
            </button>
            <span className="ml-auto">
              {mine ? (
                <button type="button" className={action} onClick={remove} aria-label="Delete post" title="Delete">
                  <TrashIcon className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" className={action} onClick={() => setReporting(true)} aria-label={`Report post by ${post.author_name}`} title="Report">
                  <FlagIcon className="h-4 w-4" />
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
      </div>
      {reporting && <ReportPostDialog postId={post.id} author={post.author_name} preview={post.body} onClose={() => setReporting(false)} />}
    </article>
  );
}
