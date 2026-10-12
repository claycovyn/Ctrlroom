import { hueFor, initials } from "@/lib/format";
import type { Profile } from "@/lib/types";

export function Avatar({ profile, size = 36, level }: { profile: Profile | undefined; size?: number; level?: number }) {
  const name = profile?.display_name ?? "?";
  const hue = profile ? hueFor(profile.id) : 0;
  const face = profile?.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={profile.avatar_url} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 45% 42%)` }}
    >
      {initials(name)}
    </span>
  );
  if (!level) return face;
  return (
    <span className="relative inline-flex h-fit shrink-0 self-start">
      {face}
      <LevelBadge level={level} className="absolute -bottom-1 -right-1" />
    </span>
  );
}

export function LevelBadge({ level, className = "" }: { level: number; className?: string }) {
  return (
    <span
      title={`Level ${level}`}
      className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-bg bg-signal px-1 text-[10px] font-bold leading-none text-signal-fg ${className}`}
    >
      {level}
    </span>
  );
}
