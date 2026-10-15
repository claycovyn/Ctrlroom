"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { shortAge } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader } from "@/components/shell/PageHeader";
import { SEEN_EVENT } from "@/lib/shell";

export interface ActivityItem {
  kind: "follow" | "request" | "approved" | "like" | "reply";
  at: string;
  actor_id: string;
  actor_username: string;
  actor_name: string;
  actor_avatar: string | null;
  post_id: string | null;
  excerpt: string | null;
}

const VERB: Record<ActivityItem["kind"], string> = {
  follow: "followed you",
  request: "asked to follow you",
  approved: "approved your follow request",
  like: "liked your post",
  reply: "replied to your post",
};

/** The list, newest first. Opening it marks everything as seen (the header's count goes back to zero). */
export function ActivityView({ me, items }: { me: { id: string; username: string }; items: ActivityItem[] }) {
  useEffect(() => {
    void supabaseBrowser()
      .rpc("mark_activity_seen")
      .then(() => window.dispatchEvent(new Event(SEEN_EVENT)));
  }, []);
  return (
    <div>
      <PageHeader title="Activity" sub="Follows, likes and replies" />
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">New followers, and likes and replies on your posts, show up here.</p>
      ) : (
        <ul>
          {items.map((i) => {
            const actor = { id: i.actor_id, username: i.actor_username, display_name: i.actor_name, avatar_url: i.actor_avatar };
            const target = i.kind === "request" ? `/u/${me.username}` : i.post_id ? `/app/feed/post/${i.post_id}` : `/u/${i.actor_username}`;
            return (
              <li key={`${i.kind}-${i.actor_id}-${i.post_id ?? ""}-${i.at}`} className="flex gap-3 border-b border-line px-4 py-3">
                <Link href={`/u/${i.actor_username}`} aria-hidden="true" tabIndex={-1}>
                  <Avatar profile={actor} size={36} />
                </Link>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <Link href={`/u/${i.actor_username}`} className="font-semibold hover:underline">
                      {i.actor_name}
                    </Link>{" "}
                    <Link href={target} className="hover:underline">
                      {VERB[i.kind]}
                    </Link>
                    <span className="text-muted"> · {shortAge(i.at)}</span>
                  </p>
                  {i.excerpt && <p className="mt-0.5 truncate text-muted">{i.excerpt}</p>}
                  {i.kind === "request" && (
                    <Link href={`/u/${me.username}`} className="mt-1 inline-block text-xs font-medium underline">
                      Approve or decline on your profile
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
