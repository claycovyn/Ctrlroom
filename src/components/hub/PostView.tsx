"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { useCommunity } from "@/components/chat/CommunityContext";
import { Composer } from "@/components/chat/Composer";
import { CheckIcon, PinIcon } from "@/components/chat/icons";
import { RichText } from "@/components/chat/RichText";
import { sinceLabel } from "@/lib/format";
import { levelFor } from "@/lib/levels";
import { useBroadcast } from "@/lib/realtime";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, ROLE_RANK, type Category, type Comment, type Post } from "@/lib/types";
import { Page } from "./PageHeader";
import { LikeButton } from "./PostCard";

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : [...list, item];
}

export function PostView({
  initialPost,
  category,
  categories,
  initialComments,
  initialLiked,
  authorRole,
}: {
  initialPost: Post;
  category: Category | null;
  categories: Category[];
  initialComments: Comment[];
  initialLiked: string[];
  authorRole: string | null;
}) {
  const { me, role, community, profiles, points, ensureProfiles, refreshPoints } = useCommunity();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const [liked, setLiked] = useState(() => new Set(initialLiked));
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [editCategory, setEditCategory] = useState(post.category_id ?? "");
  const [error, setError] = useState<string | null>(null);

  const isAuthor = post.author_id === me.id;
  const isMod = atLeast(role, "mod");
  const outranksAuthor = authorRole ? ROLE_RANK[role] > ROLE_RANK[authorRole as keyof typeof ROLE_RANK] : true;
  const canAnswer = !!category?.answers && (isAuthor || isMod);
  const level = (id: string) => (points[id] !== undefined ? levelFor(points[id]) : undefined);

  useEffect(() => {
    ensureProfiles([...new Set([post.author_id, ...initialComments.map((c) => c.author_id)])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#c-")) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, []);

  useBroadcast(`post:${post.id}`, {
    comment: (c: Comment) => {
      ensureProfiles([c.author_id]);
      setComments((list) => upsert(list, c));
    },
    comment_update: (c: Comment) => setComments((list) => (list.some((x) => x.id === c.id) ? upsert(list, c) : list)),
    post_update: (p: Post) => setPost((cur) => ({ ...cur, ...p })),
  });

  const flash = (m: string) => {
    setError(m);
    setTimeout(() => setError(null), 4000);
  };

  const { roots, replies } = useMemo(() => {
    const sorted = [...comments].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const replies = new Map<string, Comment[]>();
    sorted.forEach((c) => {
      if (c.parent_id) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    });
    let roots = sorted.filter((c) => !c.parent_id);
    // The accepted answer goes first.
    if (post.answer_comment_id) roots = [...roots.filter((c) => c.id === post.answer_comment_id), ...roots.filter((c) => c.id !== post.answer_comment_id)];
    return { roots, replies };
  }, [comments, post.answer_comment_id]);

  const toggleLike = async (kind: "post" | "comment", id: string) => {
    const was = liked.has(id);
    const d = was ? -1 : 1;
    setLiked((s) => {
      const n = new Set(s);
      if (was) n.delete(id);
      else n.add(id);
      return n;
    });
    if (kind === "post") setPost((p) => ({ ...p, like_count: p.like_count + d }));
    else setComments((list) => list.map((c) => (c.id === id ? { ...c, like_count: c.like_count + d } : c)));
    const table = kind === "post" ? "post_likes" : "comment_likes";
    const key = kind === "post" ? "post_id" : "comment_id";
    const { error: err } = was
      ? await supabase.from(table).delete().match({ [key]: id, user_id: me.id })
      : await supabase.from(table).insert({ [key]: id, user_id: me.id });
    if (err) return flash("That didn’t go through.");
    const author = kind === "post" ? post.author_id : comments.find((c) => c.id === id)?.author_id;
    if (author) refreshPoints([author]);
  };

  const sendComment = async (text: string, parentId: string | null) => {
    const { data, error: err } = await supabase
      .from("post_comments")
      .insert({ post_id: post.id, author_id: me.id, body: text, parent_id: parentId })
      .select()
      .single();
    if (err) {
      flash("Couldn’t post your comment.");
      return false;
    }
    setComments((list) => upsert(list, data as Comment));
    setReplyTo(null);
    return true;
  };

  const removeComment = async (c: Comment) => {
    if (!confirm("Delete this comment?")) return;
    const { error: err } = await supabase.rpc("delete_comment", { p_comment: c.id });
    if (err) return flash("You can’t delete that comment.");
    setComments((list) => list.map((x) => (x.id === c.id ? { ...x, deleted_at: new Date().toISOString(), body: "" } : x)));
  };

  const commentBlock = (c: Comment, isReply = false) => {
    const author = profiles[c.author_id];
    const answer = post.answer_comment_id === c.id;
    const canDelete = !c.deleted_at && (c.author_id === me.id || isMod);
    return (
      <div key={c.id} id={`c-${c.id}`} className={`flex gap-3 ${isReply ? "mt-3" : ""}`}>
        <Avatar profile={author} size={isReply ? 28 : 32} level={level(c.author_id)} />
        <div className="min-w-0 flex-1">
          <div className={`rounded-lg px-3 py-2 ${answer ? "border border-signal/60 bg-signal/10" : "bg-raised"}`}>
            {answer && (
              <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold">
                <CheckIcon className="h-3.5 w-3.5" /> Answer
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">{author?.display_name ?? "…"}</span>{" "}
              <span className="text-xs text-muted">{sinceLabel(c.created_at)}</span>
            </p>
            {c.deleted_at ? (
              <p className="text-sm italic text-muted">Comment removed</p>
            ) : (
              <p className="whitespace-pre-wrap break-words text-[15px]">
                <RichText body={c.body} myUsername={me.username} />
              </p>
            )}
          </div>
          {!c.deleted_at && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <LikeButton small count={c.like_count} liked={liked.has(c.id)} disabled={c.author_id === me.id} onClick={() => toggleLike("comment", c.id)} />
              <button className="rounded px-2 py-1 text-muted hover:bg-raised hover:text-fg" onClick={() => setReplyTo(isReply ? c.parent_id : c.id)}>
                Reply
              </button>
              {canAnswer && !isReply && c.author_id !== post.author_id && (
                <button
                  className="rounded px-2 py-1 text-muted hover:bg-raised hover:text-fg"
                  onClick={async () => {
                    const { error: err } = answer
                      ? await supabase.rpc("unmark_answer", { p_post: post.id })
                      : await supabase.rpc("mark_answer", { p_comment: c.id });
                    if (err) return flash("Couldn’t update the answer.");
                    setPost((p) => ({ ...p, answer_comment_id: answer ? null : c.id }));
                    refreshPoints([c.author_id]);
                  }}
                >
                  {answer ? "Unmark answer" : "Mark as answer"}
                </button>
              )}
              {canDelete && (
                <button className="rounded px-2 py-1 text-muted hover:bg-raised hover:text-alert" onClick={() => removeComment(c)}>
                  Delete
                </button>
              )}
            </div>
          )}
          {!isReply && (replies.get(c.id) ?? []).map((r) => commentBlock(r, true))}
          {!isReply && replyTo === c.id && (
            <div className="-mx-4 mt-2">
              <Composer placeholder={`Reply to ${author?.display_name ?? "comment"}…`} communityId={community.id} onSend={(t) => sendComment(t, c.id)} autoFocus />
            </div>
          )}
        </div>
      </div>
    );
  };

  if (post.deleted_at) {
    return (
      <Page title="Post">
        <div className="card p-8 text-center text-sm text-muted">
          This post was removed.{" "}
          <Link className="underline" href={`/c/${community.slug}/feed`}>
            Back to the feed
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title={
        <Link href={`/c/${community.slug}/feed`} className="hover:underline">
          ← Feed
        </Link>
      }
    >
      <article className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <Avatar profile={profiles[post.author_id]} size={40} level={level(post.author_id)} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-medium">{profiles[post.author_id]?.display_name ?? "…"}</div>
            <div className="text-xs text-muted">
              {sinceLabel(post.created_at)}
              {category && ` · ${category.emoji} ${category.name}`}
              {post.edited_at && " · edited"}
            </div>
          </div>
          {post.pinned && (
            <span className="inline-flex items-center gap-1 rounded bg-raised px-2 py-0.5 text-xs text-muted">
              <PinIcon className="h-3 w-3" /> Pinned
            </span>
          )}
        </div>

        {editing ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const { data, error: err } = await supabase
                .from("posts")
                .update({ title: title.trim(), body: body.trim(), category_id: editCategory || null })
                .eq("id", post.id)
                .select()
                .single();
              if (err) return flash("Couldn’t save.");
              setPost(data as Post);
              setEditing(false);
              router.refresh();
            }}
          >
            <input className="input text-base font-medium" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required aria-label="Title" />
            <textarea className="input min-h-[160px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} aria-label="Body" />
            <div className="flex gap-2">
              <select className="input w-auto" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} aria-label="Category">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
              <button className="btn-primary ml-auto">Save</button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1 className="text-2xl font-semibold leading-tight">{post.title}</h1>
            {post.body && (
              <div className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                <RichText body={post.body} myUsername={me.username} />
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-line pt-3 text-sm">
          <LikeButton count={post.like_count} liked={liked.has(post.id)} disabled={isAuthor} onClick={() => toggleLike("post", post.id)} />
          <span className="px-2 text-muted">
            {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
          </span>
          <div className="ml-auto flex gap-1">
            {isMod && (
              <button
                className="btn-ghost py-1 text-xs"
                onClick={async () => {
                  const { error: err } = await supabase.rpc("pin_post", { p_post: post.id, p_pinned: !post.pinned });
                  if (err) return flash("Couldn’t pin.");
                  setPost((p) => ({ ...p, pinned: !p.pinned }));
                }}
              >
                {post.pinned ? "Unpin" : "Pin to top"}
              </button>
            )}
            {isAuthor && !editing && (
              <button className="btn-ghost py-1 text-xs" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {(isAuthor || (isMod && outranksAuthor)) && (
              <button
                className="btn-ghost py-1 text-xs text-alert"
                onClick={async () => {
                  if (!confirm("Delete this post?")) return;
                  const { error: err } = await supabase.rpc("delete_post", { p_post: post.id });
                  if (err) return flash("You can’t delete that post.");
                  router.push(`/c/${community.slug}/feed`);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-alert" role="alert">{error}</p>}
      </article>

      {category?.answers && !post.answer_comment_id && post.comment_count > 0 && isAuthor && (
        <p className="mt-4 text-sm text-muted">Got a helpful reply? Mark it as the answer. It goes to the top, and the person who wrote it earns 5 points.</p>
      )}

      <section className="mt-6 space-y-4" aria-label="Comments">
        {roots.map((c) => commentBlock(c))}
      </section>

      <div className="-mx-4 mt-6">
        <Composer placeholder="Write a comment…" communityId={community.id} onSend={(t) => sendComment(t, null)} />
      </div>
    </Page>
  );
}
