import { communityFallback } from "@/lib/communityMedia";
import type { Community } from "@/lib/types";

type Named = Pick<Community, "name" | "icon"> & { icon_url?: string | null };

/** The community's image, or its emoji / first letter. `className` sets size, shape and background. */
export function CommunityIcon({ community, className = "" }: { community: Named; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden ${className}`}>
      {community.icon_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={community.icon_url} alt="" className="h-full w-full object-cover" />
      ) : (
        communityFallback(community)
      )}
    </span>
  );
}

/** The cover photo as a 4:1 banner (fixed ratio, so nothing jumps while it loads). Nothing when there's none. */
export function CommunityCover({ url, className = "" }: { url: string | null | undefined; className?: string }) {
  if (!url) return null;
  return (
    <div className={`aspect-[4/1] w-full shrink-0 overflow-hidden bg-raised ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}
