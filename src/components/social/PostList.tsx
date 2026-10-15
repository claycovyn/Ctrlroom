"use client";

import { useState } from "react";
import { FEED_PAGE, mergePosts, replacePost, type PostCard } from "@/lib/social";
import { PostItem } from "./PostItem";

/** A list of posts with "Show more". `loadMore` gets the oldest post's time and returns the next page. */
export function PostList({ me, posts, setPosts, loadMore, empty }: { me: { id: string; username: string }; posts: PostCard[]; setPosts: (fn: (list: PostCard[]) => PostCard[]) => void; loadMore?: (before: string) => Promise<PostCard[]>; empty: React.ReactNode }) {
  const [done, setDone] = useState(posts.length < FEED_PAGE);
  const [busy, setBusy] = useState(false);
  if (!posts.length) return <div className="px-4 py-10 text-center text-sm text-muted">{empty}</div>;
  return (
    <div>
      {posts.map((p) => (
        <PostItem key={p.id} post={p} me={me} onChange={(next) => setPosts((list) => replacePost(list, next))} onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />
      ))}
      {loadMore && !done && (
        <div className="px-4 py-4 text-center">
          <button
            type="button"
            className="btn-outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const more = await loadMore(posts[posts.length - 1].created_at).catch(() => [] as PostCard[]);
              setBusy(false);
              if (more.length < FEED_PAGE) setDone(true);
              setPosts((list) => mergePosts(list, more));
            }}
          >
            {busy ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
