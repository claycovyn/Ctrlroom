"use client";

import { CommunityCover, CommunityIcon } from "@/components/CommunityMedia";
import { ImageButtons, useImageSlot } from "@/components/ImageUpload";
import { cloudErrorText } from "@/lib/cloudErrors";
import {
  COMMUNITY_MEDIA_BUCKET,
  COMMUNITY_MEDIA_COLUMN,
  COMMUNITY_MEDIA_HINT,
  COMMUNITY_MEDIA_MAX_BYTES,
  communityMediaObjectPath,
  communityMediaPath,
  communityMediaProblem,
  type CommunityMediaKind,
} from "@/lib/communityMedia";
import type { Community } from "@/lib/types";

function useCommunitySlot(community: Community, kind: CommunityMediaKind) {
  const what = kind === "icon" ? "image" : "cover photo";
  return useImageSlot({
    bucket: COMMUNITY_MEDIA_BUCKET,
    initial: (kind === "icon" ? community.icon_url : community.cover_url) ?? null,
    problem: communityMediaProblem,
    crop: { kind, maxBytes: COMMUNITY_MEDIA_MAX_BYTES, title: kind === "icon" ? "Crop the community image" : "Crop the cover photo" },
    pathFor: (file) => communityMediaPath(community.id, kind, file.type),
    objectPathOf: (url) => communityMediaObjectPath(url, community.id, kind),
    save: async (supabase, url) => {
      const { error } = await supabase
        .from("communities")
        .update({ [COMMUNITY_MEDIA_COLUMN[kind]]: url })
        .eq("id", community.id);
      return error ? (cloudErrorText(error.message) ?? `Couldn't save the ${what}.`) : null;
    },
    removeError: `Couldn't remove the ${what}.`,
  });
}

/** Owner/admin controls for the community image (square) and cover photo (4:1). */
export function CommunityImages({ community }: { community: Community }) {
  const icon = useCommunitySlot(community, "icon");
  const cover = useCommunitySlot(community, "cover");
  const canAdd = !community.taken_down_at;

  return (
    <div className="space-y-6">
      {!canAdd && (
        <p className="text-sm text-muted">This community was taken down, so new images can’t be added. You can still remove the ones it has.</p>
      )}
      <div>
        <h3 className="mb-1 text-sm font-medium">Community image</h3>
        <p className="mb-3 text-sm text-muted">Shows in the community list and on the join page. Without one, the icon or first letter shows.</p>
        <div className="flex flex-wrap items-center gap-4">
          <CommunityIcon community={{ ...community, icon_url: icon.url }} className="h-16 w-16 rounded-xl bg-raised text-2xl" />
          <div className="min-w-0 flex-1 basis-48">
            <ImageButtons slot={icon} id="community-image" hint={COMMUNITY_MEDIA_HINT.icon} label="Community image" canAdd={canAdd} />
          </div>
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium">Cover photo</h3>
        <p className="mb-3 text-sm text-muted">A banner at the top of the community and its join page. You choose what shows in the 4:1 frame.</p>
        {cover.url ? (
          <CommunityCover url={cover.url} className="mb-3 rounded-lg border border-line" />
        ) : (
          <div className="mb-3 flex aspect-[4/1] w-full items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
            No cover photo
          </div>
        )}
        <ImageButtons slot={cover} id="community-cover" hint={COMMUNITY_MEDIA_HINT.cover} label="Cover photo" canAdd={canAdd} />
      </div>
    </div>
  );
}
