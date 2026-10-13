import { roomIconById, type RoomIconDef } from "@/lib/roomIcons";
import type { Room } from "@/lib/types";
import { HashIcon, MegaphoneIcon, VoiceIcon } from "./icons";

/**
 * One built-in room icon, drawn like the icons in ./icons.tsx (24×24, 2px stroke, currentColor, aria-hidden).
 * Shapes come from the static list in src/lib/roomIcons.ts and are mapped to <path>/<circle> elements; no markup
 * is ever injected.
 */
export function RoomIconSvg({ icon, className = "h-4 w-4" }: { icon: RoomIconDef; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {icon.shapes.map((s, i) => ("d" in s ? <path key={i} d={s.d} /> : <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />))}
    </svg>
  );
}

/**
 * A room's icon: the one it has chosen, else today's defaults (a speaker for voice rooms, a megaphone for rooms
 * only some people post in, # for the rest). Unknown ids fall back to the default.
 */
export function RoomIcon({ room, className = "h-4 w-4" }: { room: Pick<Room, "kind" | "post_min_role"> & { icon?: string | null }; className?: string }) {
  const icon = roomIconById(room.icon);
  if (icon) return <RoomIconSvg icon={icon} className={className} />;
  const Fallback = room.kind === "voice" ? VoiceIcon : room.post_min_role !== "member" ? MegaphoneIcon : HashIcon;
  return <Fallback className={className} />;
}
