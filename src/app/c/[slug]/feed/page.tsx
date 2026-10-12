import type { Metadata } from "next";
import { FeedView } from "@/components/hub/FeedView";
import { loadCommunity } from "@/lib/community";
import type { Category, Post } from "@/lib/types";

export const metadata: Metadata = { title: "Feed" };

export default async function FeedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, user, community, role } = await loadCommunity(slug);
  if (!role) return null;

  const [{ data: categories }, { data: posts }] = await Promise.all([
    supabase.from("post_categories").select("*").eq("community_id", community.id).order("position"),
    supabase
      .from("posts")
      .select("*")
      .eq("community_id", community.id)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .limit(20),
  ]);
  const ids = ((posts ?? []) as Post[]).map((p) => p.id);
  const { data: liked } = ids.length
    ? await supabase.from("post_likes").select("post_id").eq("user_id", user.id).in("post_id", ids)
    : { data: [] };

  return (
    <FeedView
      categories={(categories ?? []) as Category[]}
      initialPosts={(posts ?? []) as Post[]}
      initialLiked={((liked ?? []) as { post_id: string }[]).map((r) => r.post_id)}
    />
  );
}
