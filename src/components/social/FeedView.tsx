"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useBroadcast } from "@/lib/realtime";
import { FEED_PAGE, mergePosts, type FeedScope, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { POST_EVENT } from "./ActivityLink";
import { Composer, type Audience } from "./Composer";
import { PostList } from "./PostList";
import { PublicProfileSetup } from "./PublicProfileSetup";

const TABS: { scope: FeedScope; label: string; empty: string }[] = [
  { scope: "following", label: "Following", empty: "Posts from people you follow, and from public communities you're in or follow, show up here. Try Everyone to find people." },
  { scope: "everyone", label: "Everyone", empty: "No posts yet. Be the first." },
];

async function fetchFeed(scope: FeedScope, before: string | null): Promise<PostCard[]> {
  const { data, error } = await supabaseBrowser().rpc("feed_posts", { p_scope: scope, p_before: before, p_limit: FEED_PAGE });
  if (error) throw error;
  return (data ?? []) as PostCard[];
}

type NewPost = { id: string; author_id: string; community_id: string | null };

/**
 * The Feed: two tabs, the composer, and the posts. New posts arrive live (posts:public for public ones, your own topic
 * for private accounts you follow) and wait behind a "Show new posts" button, so the list never jumps while reading.
 */
export function FeedView({ me, scope, initial, audiences, following, communities }: { me: { id: string; username: string; bio: string; is_private: boolean; public_profile: boolean }; scope: FeedScope; initial: PostCard[]; audiences: Audience[]; following: string[]; communities: string[] }) {
  const router = useRouter();
  const [posts, setPostsState] = useState(initial);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const setPosts = (fn: (list: PostCard[]) => PostCard[]) => setPostsState((list) => fn(list));
  const tab = TABS.find((t) => t.scope === scope)!;
  const sets = useRef({ following: new Set(following), communities: new Set(communities) });

  const onPost = (p: NewPost) => {
    if (!p?.id || p.author_id === me.id) return;
    const mine = scope === "everyone" || sets.current.following.has(p.author_id) || (p.community_id !== null && sets.current.communities.has(p.community_id));
    if (!mine) return;
    setWaiting((w) => (w.includes(p.id) || posts.some((x) => x.id === p.id) ? w : [...w, p.id]));
  };
  useBroadcast("posts:public", { post: onPost });
  // Private accounts you follow: their posts come on your own topic, which the header's ActivityLink listens to.
  const onPostRef = useRef(onPost);
  onPostRef.current = onPost;
  useEffect(() => {
    const fn = (e: Event) => onPostRef.current((e as CustomEvent<NewPost>).detail);
    window.addEventListener(POST_EVENT, fn);
    return () => window.removeEventListener(POST_EVENT, fn);
  }, []);

  const showWaiting = async () => {
    const ids = waiting;
    setWaiting([]);
    const { data } = await supabaseBrowser().from("post_cards").select("*").in("id", ids).order("created_at", { ascending: false });
    setPostsState((list) => mergePosts((data ?? []) as PostCard[], list));
  };

  return (
    <main className="mx-auto max-w-2xl border-x border-line">
      <h1 className="sr-only">Feed</h1>
      <div role="tablist" aria-label="Feed" className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.scope}
            role="tab"
            aria-selected={t.scope === scope}
            className={`flex-1 py-3 text-sm font-medium ${t.scope === scope ? "border-b-2 border-signal text-fg" : "text-muted hover:text-fg"}`}
            onClick={() => router.push(t.scope === "following" ? "/app/feed" : "/app/feed?tab=everyone")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {me.public_profile ? (
        <Composer audiences={audiences} onPosted={(p) => setPosts((list) => [p, ...list])} />
      ) : (
        <PublicProfileSetup me={me} onDone={() => router.refresh()} />
      )}
      {waiting.length > 0 && (
        <div className="sticky top-[57px] z-[5] flex justify-center py-2">
          <button type="button" className="btn-primary h-8 rounded-full px-4 text-sm shadow" onClick={showWaiting}>
            Show {waiting.length} new {waiting.length === 1 ? "post" : "posts"}
          </button>
        </div>
      )}
      <div className="flex justify-end border-b border-line px-4 py-1.5">
        <button
          type="button"
          className="btn-ghost h-8 text-sm"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            const fresh = await fetchFeed(scope, null).catch(() => null);
            setRefreshing(false);
            if (fresh) {
              setPostsState(fresh);
              setWaiting([]);
            }
          }}
        >
          {refreshing ? "Checking…" : "Check for new posts"}
        </button>
      </div>
      <div role="tabpanel" aria-label={tab.label}>
        <PostList me={me} posts={posts} setPosts={setPosts} loadMore={(before) => fetchFeed(scope, before)} empty={tab.empty} />
      </div>
    </main>
  );
}
