"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useCommunity } from "./CommunityContext";
import { Panel } from "./Panel";

const ORDER: Role[] = ["owner", "admin", "mod", "member"];
const LABEL: Record<Role, string> = { owner: "Owner", admin: "Admins", mod: "Mods", member: "Members" };

export function MembersPanel({ onClose }: { onClose: () => void }) {
  const { community, addProfiles } = useCommunity();
  const [members, setMembers] = useState<{ role: Role; profile: Profile }[] | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("community_members")
      .select("role, profiles(id, username, display_name, avatar_url)")
      .eq("community_id", community.id)
      .order("joined_at")
      .limit(1000)
      .then(({ data }) => {
        const list = ((data ?? []) as unknown as { role: Role; profiles: Profile }[])
          .filter((m) => m.profiles)
          .map((m) => ({ role: m.role, profile: m.profiles }));
        addProfiles(list.map((m) => m.profile));
        setMembers(list);
      });
  }, [community.id, addProfiles]);

  return (
    <Panel title={`People${members ? ` · ${members.length}` : ""}`} onClose={onClose}>
      {!members ? (
        <p className="px-4 py-3 text-sm text-muted">Loading…</p>
      ) : (
        ORDER.map((role) => {
          const group = members.filter((m) => m.role === role);
          if (!group.length) return null;
          return (
            <section key={role} className="px-4 py-3">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {LABEL[role]} · {group.length}
              </h3>
              <ul className="space-y-2">
                {group.map(({ profile }) => (
                  <li key={profile.id} className="flex items-center gap-2">
                    <Avatar profile={profile} size={28} />
                    <span className="truncate text-sm">{profile.display_name}</span>
                    <span className="truncate text-xs text-muted">@{profile.username}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Panel>
  );
}
