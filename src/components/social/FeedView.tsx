"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RetryIcon } from "@/components/chat/icons";
import { PageHeader } from "@/components/shell/PageHeader";
import { useOptionalShell } from "@/components/shell/ShellContext";
import { useBroadcast } from "@/lib/realtime";
import { POST_EVENT, POSTED_EVENT } from "@/lib/shell";
import { FEED_PAGE, mergePosts, type FeedScope, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Composer } from "./Composer";
import { PostList } from "./PostList";
import { PublicProfileSetup } from "./PublicProfileSetup";

const TABS: { scope: FeedScope; label: string; href: string; empty: string }[] = [
  {
    scope: "following",
    label: "Following",
    href: "/app",
    empty: "Posts from people you follow, and from public communities you're in or follow, show up here. Try Everyone to find people.",
  },
  { scope: "everyone", label: "Everyone", href: "/app?tab=everyone", empty: "No posts yet. Be the first." },
];

async function fetchFeed(scope: FeedScope, before: string | null): Promise<PostCard[]> {
  const { data, error } = await supabaseBrowser().rpc("feed_posts", { p_scope: scope, p_before: before, p_limit: FEED_PAGE });
  if (error) throw error;
  return (data ?? []) as PostCard[];
}

type NewPost = { id: string; author_id: string; community_id: string | null };

/**
 * Home: the Feed's two tabs, the composer, and the posts. New posts arrive live (posts:public for public ones, your
 * own topic for private accounts you follow, passed on by the shell) and wait behind a "Show new posts" button, so the
 * list never jumps while reading.
 */
export function FeedView({
  me,
  scope,
  initial,
  following,
  followedCommunities,
  notices,
}: {
  me: { id: string; username: string; bio: string; is_private: boolean; public_profile: boolean };
  scope: FeedScope;
  initial: PostCard[];
  following: string[];
  followedCommunities: string[];
  notices?: React.ReactNode;
}) {
  const router = useRouter();
  const shell = useOptionalShell();
  const mine = shell?.communities;
  const [posts, setPostsState] = useState(initial);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const setPosts = (fn: (list: PostCard[]) => PostCard[]) => setPostsState((list) => fn(list));
  const tab = TABS.find((t) => t.scope === scope)!;
  // Posts go into public communities you're a member of.
  const audiences = useMemo(() => (mine ?? []).filter((c) => c.is_public).map((c) => ({ communityId: c.id, label: c.name })), [mine]);
  const sets = useRef({ following: new Set(following), communities: new Set<string>() });
  sets.current.communities = new Set([...(mine ?? []).map((c) => c.id), ...followedCommunities]);

  const onPost = (p: NewPost) => {
    if (!p?.id || p.author_id === me.id) return;
    const forMe = scope === "everyone" || sets.current.following.has(p.author_id) || (p.community_id !== null && sets.current.communities.has(p.community_id));
    if (!forMe) return;
    setWaiting((w) => (w.includes(p.id) || posts.some((x) => x.id === p.id) ? w : [...w, p.id]));
  };
  useBroadcast("posts:public", { post: onPost });
  const onPostRef = useRef(onPost);
  onPostRef.current = onPost;
  useEffect(() => {
    const fn = (e: Event) => onPostRef.current((e as CustomEvent<NewPost>).detail);
    // Posted from the shell's Post sheet: straight to the top.
    const posted = (e: Event) => {
      const p = (e as CustomEvent<PostCard>).detail;
      if (p?.id) setPostsState((list) => (list.some((x) => x.id === p.id) ? list : [p, ...list]));
    };
    window.addEventListener(POST_EVENT, fn);
    window.addEventListener(POSTED_EVENT, posted);
    return () => {
      window.removeEventListener(POST_EVENT, fn);
      window.removeEventListener(POSTED_EVENT, posted);
    };
  }, []);

  const showWaiting = async () => {
    const ids = waiting;
    setWaiting([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const { data } = await supabaseBrowser().from("post_cards").select("*").in("id", ids).order("created_at", { ascending: false });
    setPostsState((list) => mergePosts((data ?? []) as PostCard[], list));
  };

  const refresh = async () => {
    setRefreshing(true);
    const fresh = await fetchFeed(scope, null).catch(() => null);
    setRefreshing(false);
    if (fresh) {
      setPostsState(fresh);
      setWaiting([]);
    }
  };

  return (
    <div>
      <PageHeader
        title="Home"
        home
        right={
          <button type="button" className={`rounded-full p-2 text-muted hover:bg-raised hover:text-fg ${refreshing ? "motion-safe:animate-spin" : ""}`} disabled={refreshing} onClick={refresh} aria-label={refreshing ? "Checking for new posts" : "Check for new posts"} title="Check for new posts">
            <RetryIcon className="h-[18px] w-[18px]" />
          </button>
        }
        overlay={
          waiting.length > 0 && (
            <button type="button" className="btn-primary pointer-events-auto h-9 rounded-full px-4 text-sm font-semibold shadow-lg" onClick={showWaiting}>
              Show {waiting.length} new {waiting.length === 1 ? "post" : "posts"}
            </button>
          )
        }
      >
        <nav aria-label="Feed" className="flex">
          {TABS.map((t) => {
            const on = t.scope === scope;
            return (
              <Link
                key={t.scope}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`relative flex h-[52px] flex-1 items-center justify-center text-[15px] transition-colors hover:bg-raised/60 ${on ? "font-semibold text-fg" : "font-medium text-muted"}`}
              >
                {t.label}
                {on && <span aria-hidden="true" className="absolute bottom-0 h-1 w-14 rounded-full bg-signal" />}
              </Link>
            );
          })}
        </nav>
      </PageHeader>
      {notices}
      {me.public_profile ? (
        <Composer audiences={audiences} onPosted={(p) => setPosts((list) => [p, ...list])} />
      ) : (
        <PublicProfileSetup me={me} onDone={() => router.refresh()} />
      )}
      <section aria-label={tab.label === "Following" ? "Posts from people and communities you follow" : "Posts from everyone"}>
        <PostList me={me} posts={posts} setPosts={setPosts} loadMore={(before) => fetchFeed(scope, before)} empty={tab.empty} />
      </section>
    </div>
  );
}
