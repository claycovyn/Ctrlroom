export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { FeedView } from "@/components/social/FeedView";
import { SocialHeader } from "@/components/social/SocialHeader";
import { isConfigured } from "@/lib/env";
import { FEED_PAGE, isFeedScope, type PostCard } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Feed" };

export default async function Feed({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { tab } = await searchParams;
  const scope = isFeedScope(tab) ? tab : "following";
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/app/feed")}`);
  const [{ data: me }, { data: posts }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("id, username, bio, is_private, public_profile").eq("id", user.id).single(),
    supabase.rpc("feed_posts", { p_scope: scope, p_before: null, p_limit: FEED_PAGE }),
    supabase.from("community_members").select("communities(id, name, is_public)").eq("user_id", user.id),
  ]);
  if (!me) redirect("/app");
  // Posts go into public communities you're a member of.
  const audiences = ((memberships ?? []) as unknown as { communities: { id: string; name: string; is_public: boolean } | null }[])
    .map((m) => m.communities)
    .filter((c): c is { id: string; name: string; is_public: boolean } => !!c && c.is_public)
    .map((c) => ({ communityId: c.id, label: c.name }));
  return (
    <>
      <SocialHeader username={me.username} current="feed" />
      <FeedView key={scope} me={me} scope={scope} initial={(posts ?? []) as PostCard[]} audiences={audiences} />
    </>
  );
}
