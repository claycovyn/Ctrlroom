/** Profile photos: the rules the browser checks before uploading (Storage and the DB check them again). */
import { IMAGE_ACCEPT, IMAGE_TYPES, imageFileProblem, imagePath, publicObjectPath } from "./media";

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_TYPES = IMAGE_TYPES;
export const AVATAR_ACCEPT = IMAGE_ACCEPT;
export const AVATAR_HINT = "PNG, JPEG or WebP, up to 1 MB. Square works best.";

/** Why a file can't be used, or null when it's fine. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  return imageFileProblem(file, AVATAR_MAX_BYTES);
}

/** Where a new photo goes: `<user id>/<random>.<ext>`. */
export function avatarPath(userId: string, type: string, id?: string): string {
  return imagePath(userId, type, id);
}

/** The object path inside the bucket for a photo URL in this user's folder, or null (bots, other URLs). */
export function avatarObjectPath(url: string | null | undefined, userId: string): string | null {
  return publicObjectPath(url, AVATAR_BUCKET, userId);
}
