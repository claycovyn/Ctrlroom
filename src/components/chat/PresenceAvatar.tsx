"use client";

import type { DisplayStatus } from "@/lib/presence";
import type { Profile } from "@/lib/types";
import { Avatar } from "./Avatar";
import { HeadsetIcon, VideoIcon } from "./icons";
import { usePresence } from "./PresenceContext";

/**
 * The status mark on an avatar. Shape, not just colour, tells them apart: a filled dot (Online, signal), a hollow
 * ring (Away, silver), a dot with a bar (Do not disturb, alert), a headset or camera badge (In a call). Offline
 * shows nothing. The text is for screen readers and the tooltip.
 */
export function StatusDot({ status, label, video = false, size }: { status: DisplayStatus; label: string; video?: boolean; size: number }) {
  if (status === "offline") return null;
  const big = size >= 28;
  const dot = big ? 12 : 10;
  const common = "absolute -bottom-0.5 -right-0.5 box-content rounded-full border-2 border-panel";
  if (status === "call" && big) {
    const Icon = video ? VideoIcon : HeadsetIcon;
    return (
      <span role="img" aria-label={label} title={label} className={`${common} flex items-center justify-center bg-signal text-signal-fg`} style={{ width: 16, height: 16 }}>
        <Icon className="h-2.5 w-2.5" />
      </span>
    );
  }
  const look =
    status === "away"
      ? "bg-panel shadow-[inset_0_0_0_2.5px_rgb(var(--muted))]"
      : status === "dnd"
        ? "flex items-center justify-center bg-alert"
        : "bg-signal";
  return (
    <span role="img" aria-label={label} title={label} className={`${common} ${look}`} style={{ width: dot, height: dot }}>
      {status === "dnd" && <span className="block h-[2px] w-[60%] rounded-full bg-panel" />}
    </span>
  );
}

/** Avatar plus the person's status in this community (members only see members; outside a community, no mark). */
export function PresenceAvatar({ profile, size = 36 }: { profile: Profile | undefined; size?: number }) {
  const presence = usePresence();
  if (!presence || !profile || profile.is_bot) return <Avatar profile={profile} size={size} />;
  const { status, label, peer } = presence.statusOf(profile.id);
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar profile={profile} size={size} />
      <StatusDot status={status} label={`${profile.display_name}: ${label}`} video={peer?.call?.video} size={size} />
    </span>
  );
}
