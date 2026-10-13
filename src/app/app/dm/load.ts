import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * /app/dm[/id]: DMs live inside a community (/c/<slug>/dm) so the rail, presence and settings are there. People in no
 * community yet (someone with "Anyone" can still be messaged) get the standalone page instead.
 */
export async function dmEntry(id: string | null): Promise<Profile> {
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(id ? `/app/dm/${id}` : "/app/dm")}`);
  const { data: first } = await supabase
    .from("community_members")
    .select("communities(slug)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const slug = (first as unknown as { communities: { slug: string } | null } | null)?.communities?.slug;
  if (slug) redirect(`/c/${slug}/dm${id ? `/${id}` : ""}`);
  const { data: me } = await supabase.from("profiles").select("id, username, display_name, avatar_url, is_bot").eq("id", user.id).single();
  return me as Profile;
}
