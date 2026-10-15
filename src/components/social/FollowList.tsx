"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { cloudErrorText } from "@/lib/cloudErrors";
import { supabaseBrowser } from "@/lib/supabase/client";

export const FOLLOW_LIST_PAGE = 50;

export interface FollowRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  followed_at: string;
  /** Your relation to them: "self", "none", "pending" (you asked) or "active" (you follow them). */
  relation: "self" | "none" | "pending" | "active";
}

/** Someone's followers or who they follow, newest first, with a follow button on each person. */
export function FollowList({ username, which, initial }: { username: string; which: "followers" | "following"; initial: FollowRow[] }) {
  const [rows, setRows] = useState(initial);
  const [done, setDone] = useState(initial.length < FOLLOW_LIST_PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sb = supabaseBrowser;

  const more = async () => {
    setBusy("more");
    const { data } = await sb().rpc("profile_follows", { p_username: username, p_which: which, p_before: rows[rows.length - 1].followed_at, p_limit: FOLLOW_LIST_PAGE });
    setBusy(null);
    const next = (data ?? []) as FollowRow[];
    if (next.length < FOLLOW_LIST_PAGE) setDone(true);
    setRows((list) => [...list, ...next.filter((n) => !list.some((x) => x.id === n.id))]);
  };

  const toggle = async (r: FollowRow) => {
    setBusy(r.id);
    setError(null);
    const following = r.relation === "active" || r.relation === "pending";
    const { data, error: err } = await sb().rpc(following ? "unfollow_user" : "follow_user", { p_user: r.id });
    if (err) {
      setBusy(null);
      return setError(cloudErrorText(err.message) ?? "Couldn't do that. Try again.");
    }
    // A private account turns a follow into a request.
    const relation: FollowRow["relation"] = following ? "none" : data === "pending" ? "pending" : "active";
    setBusy(null);
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, relation } : x)));
  };

  return (
    <main className="mx-auto max-w-2xl border-x border-line">
      <nav className="flex border-b border-line" aria-label="Lists">
        {(["followers", "following"] as const).map((w) => (
          <Link
            key={w}
            href={`/u/${username}/${w}`}
            aria-current={w === which ? "page" : undefined}
            className={`flex-1 py-3 text-center text-sm font-medium ${w === which ? "border-b-2 border-signal text-fg" : "text-muted hover:text-fg"}`}
          >
            {w === "followers" ? "Followers" : "Following"}
          </Link>
        ))}
      </nav>
      <h1 className="sr-only">{which === "followers" ? `People following @${username}` : `People @${username} follows`}</h1>
      {error && (
        <p role="alert" className="border-b border-line px-4 py-2 text-sm text-alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">{which === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Link href={`/u/${r.username}`} aria-hidden="true" tabIndex={-1}>
                <Avatar profile={r} size={40} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/u/${r.username}`} className="block truncate font-semibold hover:underline">
                  {r.display_name}
                </Link>
                <p className="truncate text-sm text-muted">@{r.username}</p>
                {r.bio && <p className="mt-0.5 line-clamp-2 text-sm">{r.bio}</p>}
              </div>
              {r.relation !== "self" && (
                <button
                  type="button"
                  className={r.relation === "none" ? "btn-primary h-8 text-sm" : "btn-outline h-8 text-sm"}
                  disabled={busy === r.id}
                  aria-label={`${r.relation === "none" ? "Follow" : r.relation === "pending" ? "Cancel request to" : "Unfollow"} @${r.username}`}
                  onClick={() => toggle(r)}
                >
                  {r.relation === "none" ? "Follow" : r.relation === "pending" ? "Requested" : "Following"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!done && rows.length > 0 && (
        <div className="px-4 py-4 text-center">
          <button type="button" className="btn-outline" disabled={busy === "more"} onClick={more}>
            {busy === "more" ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </main>
  );
}
