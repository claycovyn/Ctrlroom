"use client";

import Link from "next/link";
import { useState } from "react";
import { CommunityIcon } from "@/components/CommunityMedia";
import { cloudErrorText } from "@/lib/cloudErrors";
import { useBroadcast } from "@/lib/realtime";
import { FEED_PAGE, mergePosts, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Composer } from "./Composer";
import { PostList } from "./PostList";

export interface CommunityPostsInfo {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  is_public: boolean;
  member: boolean;
  following: boolean;
}

async function fetchPosts(communityId: string, before: string | null): Promise<PostCard[]> {
  let q = supabaseBrowser().from("post_cards").select("*").eq("community_id", communityId).is("reply_to", null);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(FEED_PAGE);
  if (error) throw error;
  return (data ?? []) as PostCard[];
}

/**
 * A public community's posts: members post here, anyone signed in can read and follow it (its posts then show up in
 * their Following tab). New posts arrive live behind a "Show new posts" button.
 */
export function CommunityPostsView({ me, community, initial }: { me: { id: string; username: string; public_profile: boolean }; community: CommunityPostsInfo; initial: PostCard[] }) {
  const [posts, setPostsState] = useState(initial);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [following, setFollowing] = useState(community.following);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPosts = (fn: (list: PostCard[]) => PostCard[]) => setPostsState((list) => fn(list));

  useBroadcast("posts:public", {
    post: (p: { id: string; author_id: string; community_id: string | null }) => {
      if (!p?.id || p.community_id !== community.id || p.author_id === me.id) return;
      setWaiting((w) => (w.includes(p.id) || posts.some((x) => x.id === p.id) ? w : [...w, p.id]));
    },
  });

  const showWaiting = async () => {
    const ids = waiting;
    setWaiting([]);
    const { data } = await supabaseBrowser().from("post_cards").select("*").in("id", ids).order("created_at", { ascending: false });
    setPostsState((list) => mergePosts((data ?? []) as PostCard[], list));
  };

  const toggleFollow = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc(following ? "unfollow_community" : "follow_community", { p_community: community.id });
    setBusy(false);
    if (err) return setError(cloudErrorText(err.message) ?? "Couldn't do that. Try again.");
    setFollowing(!following);
  };

  return (
    <main className="mx-auto max-w-2xl border-x border-line">
      <div className="flex items-start gap-3 border-b border-line px-4 py-4">
        <CommunityIcon community={community} className="h-12 w-12 rounded-xl bg-raised text-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{community.name}</h1>
          <p className="text-sm text-muted">Posts{community.is_public ? "" : " · private community"}</p>
          {community.description && <p className="mt-1 text-sm">{community.description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {community.member ? (
            <Link href={`/c/${community.slug}`} className="btn-outline h-9">
              Open chat
            </Link>
          ) : (
            <>
              <button type="button" className={following ? "btn-outline h-9" : "btn-primary h-9"} disabled={busy} onClick={toggleFollow} aria-pressed={following}>
                {following ? "Following" : "Follow"}
              </button>
              <Link href={`/c/${community.slug}`} className="text-xs text-muted underline">
                Join to post
              </Link>
            </>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="border-b border-line px-4 py-2 text-sm text-alert">
          {error}
        </p>
      )}
      {community.member && community.is_public && me.public_profile && (
        <Composer communityId={community.id} placeholder={`Post to ${community.name}`} onPosted={(p) => setPosts((list) => [p, ...list])} />
      )}
      {community.member && community.is_public && !me.public_profile && (
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          Your public profile is off, so you can&apos;t post.{" "}
          <Link href="/app/feed" className="underline">
            Turn it on in the Feed
          </Link>
          .
        </p>
      )}
      {waiting.length > 0 && (
        <div className="sticky top-[57px] z-[5] flex justify-center py-2">
          <button type="button" className="btn-primary h-8 rounded-full px-4 text-sm shadow" onClick={showWaiting}>
            Show {waiting.length} new {waiting.length === 1 ? "post" : "posts"}
          </button>
        </div>
      )}
      <PostList
        me={me}
        posts={posts}
        setPosts={setPosts}
        loadMore={(before) => fetchPosts(community.id, before)}
        empty={community.is_public ? (community.member ? "No posts yet. Be the first." : "No posts yet.") : "Only public communities have posts."}
      />
    </main>
  );
}
