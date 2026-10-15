"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { useConfirm } from "@/components/Dialogs";
import { cloudErrorText } from "@/lib/cloudErrors";
import { BIO_MAX, countLabel, FEED_PAGE, type PostCard, type ProfileView as ProfileRow } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PostList } from "./PostList";
import { PublicProfileSetup } from "./PublicProfileSetup";

export interface FollowRequest {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

type Me = { id: string; username: string; bio: string; is_private: boolean; public_profile: boolean };

/** A profile page: header and actions, your follow requests (on your own), and the posts (or why they're hidden). */
export function ProfileView({ me, profile, initialPosts, requests }: { me: Me; profile: ProfileRow; initialPosts: PostCard[]; requests: FollowRequest[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [posts, setPosts] = useState(initialPosts);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = profile.relation === "self";

  /** One call, then the page reloads its data (counts, relation, posts). */
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error: err } = await fn();
    setBusy(false);
    if (err) return setError(cloudErrorText(err.message) ?? "Couldn't do that. Try again.");
    router.refresh();
  };
  const sb = () => supabaseBrowser();

  const follow = () => act(() => sb().rpc("follow_user", { p_user: profile.id }));
  const unfollow = async () => {
    if (profile.relation === "active" && !(await confirm({ title: `Unfollow @${profile.username}?`, body: profile.is_private ? "Their posts are only for followers, so you'd have to ask again." : undefined, confirmLabel: "Unfollow" }))) return;
    await act(() => sb().rpc("unfollow_user", { p_user: profile.id }));
  };
  const block = async () => {
    if (!(await confirm({ title: `Block @${profile.username}?`, body: "Neither of you will see the other's posts, and follows between you end. They can't message you or follow you.", confirmLabel: "Block", tone: "danger" }))) return;
    await act(() => sb().rpc("block_user", { p_user: profile.id }));
  };

  return (
    <main className="mx-auto max-w-2xl border-x border-line">
      <section className="border-b border-line px-4 py-5" aria-labelledby="profile-name">
        <div className="flex items-start gap-4">
          <Avatar profile={profile} size={72} />
          <div className="min-w-0 flex-1">
            <h1 id="profile-name" className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">
              {profile.display_name}
            </h1>
            <p className="text-muted">
              @{profile.username}
              {profile.follows_you && !self && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-xs">Follows you</span>}
              {profile.is_private && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-xs">Private account</span>}
            </p>
            {profile.bio && <p className="mt-2 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{profile.bio}</p>}
            <p className="mt-2 text-sm text-muted">
              {profile.can_see_posts ? (
                <>
                  <Link href={`/u/${profile.username}/followers`} className="hover:text-fg hover:underline">
                    {countLabel(profile.followers, "follower", "followers")}
                  </Link>{" "}
                  ·{" "}
                  <Link href={`/u/${profile.username}/following`} className="hover:text-fg hover:underline">
                    {profile.following.toLocaleString("en-US")} following
                  </Link>
                </>
              ) : (
                <>
                  {countLabel(profile.followers, "follower", "followers")} · {profile.following.toLocaleString("en-US")} following
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {self ? (
            profile.public_profile && (
              <button type="button" className="btn-outline" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                Edit profile
              </button>
            )
          ) : profile.you_blocked ? (
            <button type="button" className="btn-outline" disabled={busy} onClick={() => act(() => sb().rpc("unblock_user", { p_user: profile.id }))}>
              Unblock
            </button>
          ) : (
            <>
              {profile.public_profile && !profile.is_bot && (
                <button type="button" className={profile.relation === "none" ? "btn-primary" : "btn-outline"} disabled={busy} onClick={profile.relation === "none" ? follow : unfollow}>
                  {profile.relation === "active" ? "Following" : profile.relation === "pending" ? "Requested" : profile.is_private ? "Ask to follow" : "Follow"}
                </button>
              )}
              {profile.follows_you && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => act(() => sb().rpc("remove_follower", { p_user: profile.id }))}>
                  Remove follower
                </button>
              )}
              {!profile.is_bot && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={block}>
                  Block
                </button>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-alert">
            {error}
          </p>
        )}
        {self && editing && <EditProfile me={me} onSaved={() => (setEditing(false), router.refresh())} />}
      </section>

      {self && requests.length > 0 && (
        <section className="border-b border-line px-4 py-3" aria-labelledby="requests-title">
          <h2 id="requests-title" className="mb-2 text-sm font-semibold">
            Follow requests
          </h2>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <Avatar profile={r} size={32} />
                <a href={`/u/${r.username}`} className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{r.display_name}</span> <span className="text-muted">@{r.username}</span>
                </a>
                <button type="button" className="btn-primary h-8" disabled={busy} onClick={() => act(() => sb().rpc("answer_follow_request", { p_user: r.id, p_accept: true }))}>
                  Approve
                </button>
                <button type="button" className="btn-ghost h-8" disabled={busy} onClick={() => act(() => sb().rpc("answer_follow_request", { p_user: r.id, p_accept: false }))}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {self && !profile.public_profile ? (
        <PublicProfileSetup me={me} onDone={() => router.refresh()} />
      ) : profile.can_see_posts ? (
        <>
          <h2 className="sr-only">Posts</h2>
          <PostList
            me={me}
            posts={posts}
            setPosts={(fn) => setPosts(fn)}
            loadMore={async (before) => {
              const { data } = await supabaseBrowser().from("post_cards").select("*").eq("author_id", profile.id).is("reply_to", null).lt("created_at", before).order("created_at", { ascending: false }).limit(FEED_PAGE);
              return (data ?? []) as PostCard[];
            }}
            empty={self ? "You haven't posted yet. Share something from the Feed." : "No posts yet."}
          />
        </>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-muted">
          {profile.you_blocked
            ? "You blocked this account."
            : !profile.public_profile
              ? `@${profile.username} doesn't have a public profile.`
              : `@${profile.username}'s posts are only for followers. ${profile.relation === "pending" ? "Your request is waiting for approval." : "Ask to follow to see them."}`}
        </p>
      )}
    </main>
  );
}

function EditProfile({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const id = useId();
  const confirm = useConfirm();
  const [bio, setBio] = useState(me.bio);
  const [priv, setPriv] = useState(me.is_private);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sb = supabaseBrowser();

  const run = async (steps: (() => PromiseLike<{ error: { message: string } | null }>)[]) => {
    setBusy(true);
    setError(null);
    for (const step of steps) {
      const { error: err } = await step();
      if (err) {
        setBusy(false);
        return setError(cloudErrorText(err.message) ?? "Couldn't save that. Try again.");
      }
    }
    setBusy(false);
    onSaved();
  };

  return (
    <form
      className="card mt-4 space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run([() => sb.from("profiles").update({ bio: bio.trim() }).eq("id", me.id), () => sb.rpc("set_private_account", { p_private: priv })]);
      }}
    >
      <div>
        <label htmlFor={`${id}-bio`} className="mb-1 block text-sm font-medium">
          Bio
        </label>
        <textarea id={`${id}-bio`} className="input min-h-[3.5rem]" value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
        <span>
          <span className="font-medium">Private account</span>
          <span className="block text-muted">Only followers you approve see your posts. Turning it off approves everyone waiting.</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          Save
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={async () => {
            if (await confirm({ title: "Turn off your public profile?", body: "Your profile and posts are hidden again. Nothing is deleted; turn it back on any time.", confirmLabel: "Turn off" }))
              void run([() => sb.rpc("set_public_profile", { p_on: false })]);
          }}
        >
          Turn off public profile
        </button>
      </div>
    </form>
  );
}
