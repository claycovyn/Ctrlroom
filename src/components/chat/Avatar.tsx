import { hueFor, initials } from "@/lib/format";
import type { Profile } from "@/lib/types";

export function Avatar({ profile, size = 36 }: { profile: Profile | undefined; size?: number }) {
  const name = profile?.display_name ?? "?";
  if (profile?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={profile.avatar_url} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" />;
  }
  const hue = profile ? hueFor(profile.id) : 0;
  return (
    <span
      aria-hidden="true"
      data-initials={initials(name)}
      className="flex shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white after:content-[attr(data-initials)]"
      // The initials are decoration (the name is always next to it); 32% lightness keeps white text at 4.5:1 or
      // better on every hue. Big avatars (profiles) get bigger initials.
      style={{ width: size, height: size, background: `hsl(${hue} 45% 32%)`, ...(size >= 56 ? { fontSize: Math.round(size * 0.34) } : {}) }}
    />
  );
}
