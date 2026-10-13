"use client";

import { useEffect, useState } from "react";
import { GROUP_LABEL, GROUP_ORDER, presenceGroup } from "@/lib/presence";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import { HeadsetIcon, VideoIcon } from "./icons";
import { Panel } from "./Panel";
import { PresenceAvatar } from "./PresenceAvatar";
import { usePresence } from "./PresenceContext";

const ROLE_TAG: Partial<Record<Role, string>> = { owner: "Owner", admin: "Admin", mod: "Mod" };

export function MembersPanel({ onClose }: { onClose: () => void }) {
  const { community, addProfiles, rooms } = useCommunity();
  const presence = usePresence();
  const [members, setMembers] = useState<{ role: Role; profile: Profile }[] | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("community_members")
      .select("role, profiles(id, username, display_name, avatar_url, is_bot)")
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

  const people = members?.filter((m) => !m.profile.is_bot) ?? [];
  const helpers = members?.filter((m) => m.profile.is_bot) ?? [];
  const byName = (a: { profile: Profile }, b: { profile: Profile }) => a.profile.display_name.localeCompare(b.profile.display_name);

  return (
    <Panel title={`People${members ? ` · ${members.length}` : ""}`} onClose={onClose}>
      {!members ? (
        <p className="px-4 py-3 text-sm text-muted">Loading…</p>
      ) : (
        <>
          {GROUP_ORDER.map((g) => {
            const group = people.filter((m) => presenceGroup(presence?.peers[m.profile.id]) === g).sort(byName);
            if (!group.length) return null;
            return (
              <section key={g} className="px-4 py-3" aria-label={`${GROUP_LABEL[g]} · ${group.length}`}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {GROUP_LABEL[g]} · {group.length}
                </h3>
                <ul className="space-y-2">
                  {group.map(({ profile, role }) => {
                    const peer = presence?.peers[profile.id];
                    const label = presence?.statusOf(profile.id).label ?? "";
                    const room = peer?.call ? rooms.find((r) => r.id === peer.call!.room_id) : undefined;
                    const Glyph = peer?.call?.video ? VideoIcon : HeadsetIcon;
                    return (
                      <li key={profile.id} className={`flex items-center gap-2 ${g === "offline" ? "opacity-60" : ""}`}>
                        <PresenceAvatar profile={profile} size={28} />
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="flex items-baseline gap-1.5">
                            <span className="truncate text-sm">{profile.display_name}</span>
                            {ROLE_TAG[role] && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">{ROLE_TAG[role]}</span>}
                          </div>
                          {peer?.call ? (
                            <div className="flex items-center gap-1 truncate text-xs text-muted">
                              <Glyph className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {peer.status === "dnd" ? "Do not disturb · " : ""}
                                {room ? `#${room.name}` : "In a call"}
                              </span>
                            </div>
                          ) : peer?.status === "dnd" ? (
                            <div className="truncate text-xs text-muted">Do not disturb</div>
                          ) : (
                            <div className="truncate text-xs text-muted">@{profile.username}</div>
                          )}
                        </div>
                        <span className="sr-only">{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {helpers.length > 0 && (
            <section className="px-4 py-3" aria-label={`AI helpers · ${helpers.length}`}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">AI helpers · {helpers.length}</h3>
              <ul className="space-y-2">
                {helpers.map(({ profile }) => (
                  <li key={profile.id} className="flex items-center gap-2">
                    <PresenceAvatar profile={profile} size={28} />
                    <span className="truncate text-sm">{profile.display_name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Panel>
  );
}
