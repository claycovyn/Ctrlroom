export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { SocialHeader } from "@/components/social/SocialHeader";
import { ThreadView } from "@/components/social/ThreadView";
import { isConfigured } from "@/lib/env";
import type { PostCard } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Post" };

/** A post and its replies, oldest reply first. Missing, deleted or not yours to see: not found. */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/feed/post/${id}`)}`);
  const [{ data: me }, { data: post }, { data: replies }] = await Promise.all([
    supabase.from("profiles").select("id, username, public_profile").eq("id", user.id).single(),
    supabase.from("post_cards").select("*").eq("id", id).maybeSingle(),
    supabase.from("post_cards").select("*").eq("reply_to", id).order("created_at", { ascending: true }).limit(200),
  ]);
  if (!post || !me) notFound();
  const parent = (post as PostCard).reply_to ? (await supabase.from("post_cards").select("*").eq("id", (post as PostCard).reply_to!).maybeSingle()).data : null;
  return (
    <>
      <SocialHeader me={me} />
      <ThreadView me={me} parent={(parent as PostCard | null) ?? null} post={post as PostCard} initialReplies={(replies ?? []) as PostCard[]} />
    </>
  );
}
