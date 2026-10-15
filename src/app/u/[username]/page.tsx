export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { ProfileView, type FollowRequest } from "@/components/social/ProfileView";
import { SocialHeader } from "@/components/social/SocialHeader";
import { isConfigured } from "@/lib/env";
import { FEED_PAGE, type PostCard, type ProfileView as ProfileRow } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  return { title: `@${(await params).username}`, robots: { index: false } };
}

/** A profile: who they are and, when you're allowed, what they post. Someone you can't see is "not found". */
export default async function Profile({ params }: { params: Promise<{ username: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const username = (await params).username.toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(username)) notFound();
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/u/${username}`)}`);
  const [{ data: rows }, { data: me }] = await Promise.all([
    supabase.rpc("profile_view", { p_username: username }),
    supabase.from("profiles").select("id, username, bio, is_private, public_profile").eq("id", user.id).single(),
  ]);
  const profile = ((rows ?? []) as ProfileRow[])[0];
  if (!profile || !me) notFound();
  const [{ data: posts }, { data: requests }] = await Promise.all([
    profile.can_see_posts
      ? supabase.from("post_cards").select("*").eq("author_id", profile.id).is("reply_to", null).order("created_at", { ascending: false }).limit(FEED_PAGE)
      : Promise.resolve({ data: [] }),
    profile.relation === "self" ? supabase.rpc("my_follow_requests") : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <SocialHeader username={me.username} current={profile.relation === "self" ? "me" : undefined} />
      <ProfileView me={me} profile={profile} initialPosts={(posts ?? []) as PostCard[]} requests={(requests ?? []) as FollowRequest[]} />
    </>
  );
}
