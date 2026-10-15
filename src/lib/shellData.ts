import "server-only";
import { cache } from "react";
import type { ShellCommunity, ShellMe } from "./shell";
import { currentUser } from "./supabase/server";

/**
 * The signed-in shell's data, once per request (the layout and the page both ask): you and the communities you're in,
 * oldest membership first. Null when signed out.
 */
export const loadShell = cache(async (): Promise<{ me: ShellMe; communities: ShellCommunity[] } | null> => {
  const { supabase, user } = await currentUser();
  if (!user) return null;
  const [{ data: me }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, avatar_url, bio, is_private, public_profile").eq("id", user.id).single(),
    supabase
      .from("community_members")
      .select("role, communities(id, slug, name, description, icon, icon_url, is_public)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true }),
  ]);
  if (!me) return null;
  const communities = ((memberships ?? []) as unknown as { role: ShellCommunity["role"]; communities: Omit<ShellCommunity, "role"> | null }[])
    .filter((m) => m.communities)
    .map((m) => ({ ...m.communities!, role: m.role }));
  return { me: { ...(me as ShellMe), bio: (me as ShellMe).bio ?? "" }, communities };
});
