export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { CommunityPostsView } from "@/components/social/CommunityPostsView";
import { SocialHeader } from "@/components/social/SocialHeader";
import { isConfigured } from "@/lib/env";
import { FEED_PAGE, type PostCard } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: `Posts · ${(await params).slug}`, robots: { index: false } };
}

/** A community's posts. Public communities only (a private one you're in says so); anyone else gets "not found". */
export default async function CommunityPosts({ params }: { params: Promise<{ slug: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const slug = (await params).slug.toLowerCase();
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/feed/c/${slug}`)}`);
  const { data: community } = await supabase.from("communities").select("id, slug, name, description, icon, is_public").eq("slug", slug).maybeSingle();
  if (!community) notFound();
  const [{ data: me }, { data: member }, { data: follow }, { data: posts }] = await Promise.all([
    supabase.from("profiles").select("id, username, bio, is_private, public_profile").eq("id", user.id).single(),
    supabase.from("community_members").select("user_id").eq("community_id", community.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("community_follows").select("community_id").eq("community_id", community.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("post_cards").select("*").eq("community_id", community.id).is("reply_to", null).order("created_at", { ascending: false }).limit(FEED_PAGE),
  ]);
  if (!me) redirect("/app");
  return (
    <>
      <SocialHeader me={me} />
      <CommunityPostsView me={me} community={{ ...community, member: !!member, following: !!follow }} initial={(posts ?? []) as PostCard[]} />
    </>
  );
}
