import type { Metadata } from "next";
import { LeaderboardView } from "@/components/hub/LeaderboardView";
import { loadCommunity } from "@/lib/community";
import type { Standing } from "@/lib/types";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, community, role } = await loadCommunity(slug);
  if (!role) return null;
  const [{ data: standing }, { data: rows }, { data: unlocks }] = await Promise.all([
    supabase.rpc("my_standing", { p_community: community.id }),
    supabase.rpc("leaderboard", { p_community: community.id, p_period: "7d", p_limit: 50 }),
    supabase.from("courses").select("title, unlock_level").eq("community_id", community.id).eq("published", true).gt("unlock_level", 1),
  ]);
  return (
    <LeaderboardView
      standing={(standing as Standing) ?? null}
      initialRows={(rows ?? []) as { user_id: string; points: number; total_points: number; level: number }[]}
      unlocks={(unlocks ?? []) as { title: string; unlock_level: number }[]}
    />
  );
}
