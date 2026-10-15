export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/shell/PageHeader";
import { FOLLOW_LIST_PAGE, FollowList, type FollowRow } from "@/components/social/FollowList";
import { isConfigured } from "@/lib/env";
import type { ProfileView as ProfileRow } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";

const LISTS = ["followers", "following"] as const;

export async function generateMetadata({ params }: { params: Promise<{ username: string; list: string }> }): Promise<Metadata> {
  const { username, list } = await params;
  return { title: `@${username} · ${list === "following" ? "Following" : "Followers"}`, robots: { index: false } };
}

/** /u/<name>/followers and /u/<name>/following. Lists you aren't allowed to see are "not found", like the profile. */
export default async function FollowLists({ params }: { params: Promise<{ username: string; list: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const p = await params;
  const username = p.username.toLowerCase();
  const which = LISTS.find((l) => l === p.list);
  if (!which || !/^[a-z0-9_]{2,32}$/.test(username)) notFound();
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/u/${username}/${which}`)}`);
  const [{ data: profiles }, { data: rows }] = await Promise.all([
    supabase.rpc("profile_view", { p_username: username }),
    supabase.rpc("profile_follows", { p_username: username, p_which: which, p_before: null, p_limit: FOLLOW_LIST_PAGE }),
  ]);
  const profile = ((profiles ?? []) as ProfileRow[])[0];
  if (!profile || !profile.can_see_posts) notFound();
  return (
    <>
      <PageHeader title={profile.display_name} sub={`@${profile.username}`} back={`/u/${profile.username}`} />
      <FollowList username={profile.username} which={which} initial={(rows ?? []) as FollowRow[]} />
    </>
  );
}
