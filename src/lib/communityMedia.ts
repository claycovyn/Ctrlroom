/** Community image (icon) and cover photo: the rules the browser checks before uploading
 *  (Storage and the DB check them again, see supabase/migrations/0006_community_media.sql). */
import { imageFileProblem, imagePath, publicObjectPath } from "./media";

export const COMMUNITY_MEDIA_BUCKET = "community-media";
export const COMMUNITY_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export type CommunityMediaKind = "icon" | "cover";

export const COMMUNITY_MEDIA_HINT: Record<CommunityMediaKind, string> = {
  icon: "PNG, JPEG or WebP. We'll help you crop it.",
  cover: "PNG, JPEG or WebP. We'll help you crop it.",
};

/** The column each kind is saved in. */
export const COMMUNITY_MEDIA_COLUMN = { icon: "icon_url", cover: "cover_url" } as const;

export function communityMediaProblem(file: { type: string; size: number }): string | null {
  return imageFileProblem(file, COMMUNITY_MEDIA_MAX_BYTES);
}

/** Where a new image goes: `<community id>/<icon|cover>/<random>.<ext>`. */
export function communityMediaPath(communityId: string, kind: CommunityMediaKind, type: string, id?: string): string {
  return imagePath(`${communityId}/${kind}`, type, id);
}

/** The object path for an image URL in this community's folder of this kind, or null. */
export function communityMediaObjectPath(url: string | null | undefined, communityId: string, kind: CommunityMediaKind): string | null {
  return publicObjectPath(url, COMMUNITY_MEDIA_BUCKET, `${communityId}/${kind}`);
}

/** What a community shows when it has no image: its emoji icon, or the first letter of its name. */
export function communityFallback(c: { icon?: string | null; name: string }): string {
  return c.icon?.trim() || c.name.trim().slice(0, 1).toUpperCase() || "?";
}
