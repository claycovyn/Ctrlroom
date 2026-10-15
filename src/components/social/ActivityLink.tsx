"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBroadcast } from "@/lib/realtime";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Window events: a new post for you (the Feed listens), and "activity seen" (the Activity page sends it). */
export const POST_EVENT = "ctrlroom:post";
export const SEEN_EVENT = "ctrlroom:activity-seen";

/**
 * "Activity" with a count of what's new (follows, requests, likes, replies). It's the one listener on your own topic on
 * these pages: it counts activity and passes new-post events on to the Feed.
 */
export function ActivityLink({ userId, current }: { userId: string; current: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void supabaseBrowser()
      .rpc("my_activity_unseen")
      .then(({ data }) => live && setCount(Number(data ?? 0)));
    const seen = () => setCount(0);
    window.addEventListener(SEEN_EVENT, seen);
    return () => {
      live = false;
      window.removeEventListener(SEEN_EVENT, seen);
    };
  }, []);
  const bump = () => !current && setCount((n) => n + 1);
  useBroadcast(`user:${userId}`, {
    follow: bump,
    follow_approved: bump,
    post_like: bump,
    post_reply: bump,
    post: (p: unknown) => window.dispatchEvent(new CustomEvent(POST_EVENT, { detail: p })),
  });
  return (
    <Link href="/app/feed/activity" className="btn-ghost relative" aria-current={current ? "page" : undefined} aria-label={count > 0 ? `Activity, ${count} new` : "Activity"}>
      Activity
      {count > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
