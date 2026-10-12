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
      className="flex shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 45% 42%)` }}
    >
      {initials(name)}
    </span>
  );
}
