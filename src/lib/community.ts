import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import type { Community, Profile, Role, Room } from "@/lib/types";

/** Everything the community layout and its pages share. Cached per request. */
export const loadCommunity = cache(async (slug: string) => {
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/c/${slug}`)}`);

  const { data: community } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
  if (!community) notFound();

  const [{ data: membership }, { data: me }, { data: rooms }, { data: mine }] = await Promise.all([
    supabase.from("community_members").select("role").eq("community_id", community.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("id, username, display_name, avatar_url").eq("id", user.id).single(),
    supabase.from("rooms").select("*").eq("community_id", community.id).order("position").order("name"),
    supabase.from("community_members").select("communities(*)").eq("user_id", user.id).order("joined_at"),
  ]);

  return {
    supabase,
    user,
    community: community as Community,
    role: (membership?.role ?? null) as Role | null,
    me: me as Profile,
    rooms: (rooms ?? []) as Room[],
    communities: ((mine ?? []) as unknown as { communities: Community | null }[])
      .map((m) => m.communities)
      .filter((c): c is Community => !!c),
  };
});
