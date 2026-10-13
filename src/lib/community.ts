import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import type { Community, Profile, Role, Room, RoomPin, RoomSection } from "@/lib/types";

/** Everything the community layout and its pages share. Cached per request. */
export const loadCommunity = cache(async (slug: string) => {
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/c/${slug}`)}`);

  const { data: community } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
  if (!community) notFound();

  const [{ data: membership }, { data: me }, { data: rooms }, { data: mine }, { data: sections }, { data: pins }] = await Promise.all([
    supabase.from("community_members").select("role").eq("community_id", community.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("id, username, display_name, avatar_url, is_bot").eq("id", user.id).single(),
    supabase.from("rooms").select("*").eq("community_id", community.id).order("position").order("name"),
    supabase.from("community_members").select("communities(*)").eq("user_id", user.id).order("joined_at"),
    supabase.from("room_sections").select("id, community_id, name, position").eq("community_id", community.id).order("position").order("name"),
    // Your own pins only (RLS); at most 20 per community, filtered to this community's rooms below.
    supabase.from("room_pins").select("room_id, created_at").order("created_at"),
  ]);

  const roomList = (rooms ?? []) as Room[];
  const roomIds = new Set(roomList.map((r) => r.id));
  return {
    supabase,
    user,
    community: community as Community,
    role: (membership?.role ?? null) as Role | null,
    me: me as Profile,
    rooms: roomList,
    sections: (sections ?? []) as RoomSection[],
    pins: ((pins ?? []) as RoomPin[]).filter((p) => roomIds.has(p.room_id)),
    communities: ((mine ?? []) as unknown as { communities: Community | null }[])
      .map((m) => m.communities)
      .filter((c): c is Community => !!c),
  };
});
