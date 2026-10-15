"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FEED_PAGE, type FeedScope, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
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

/** The Feed: two tabs, the composer (once the public profile is on), and the posts. */
export function FeedView({ me, scope, initial, audiences }: { me: { id: string; username: string; bio: string; is_private: boolean; public_profile: boolean }; scope: FeedScope; initial: PostCard[]; audiences: Audience[] }) {
  const router = useRouter();
  const [posts, setPostsState] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const setPosts = (fn: (list: PostCard[]) => PostCard[]) => setPostsState((list) => fn(list));
  const tab = TABS.find((t) => t.scope === scope)!;

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
        <Composer me={me} audiences={audiences} onPosted={(p) => setPosts((list) => [p, ...list])} />
      ) : (
        <PublicProfileSetup me={me} onDone={() => router.refresh()} />
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
            if (fresh) setPostsState(fresh);
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
