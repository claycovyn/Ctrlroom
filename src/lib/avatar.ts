/** Profile photos: the rules the browser checks before uploading (Storage and the DB check them again). */

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const AVATAR_ACCEPT = Object.keys(AVATAR_TYPES).join(",");
export const AVATAR_HINT = "PNG, JPEG or WebP, up to 1 MB. Square works best.";

/** Why a file can't be used, or null when it's fine. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES[file.type]) return "Use a PNG, JPEG or WebP image.";
  if (file.size > AVATAR_MAX_BYTES) return "That image is over 1 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Where a new photo goes: `<user id>/<random>.<ext>`. */
export function avatarPath(userId: string, type: string, id: string = crypto.randomUUID()): string {
  return `${userId}/${id}.${AVATAR_TYPES[type] ?? "png"}`;
}

/** The object path inside the bucket for a photo URL in this user's folder, or null (bots, other URLs). */
export function avatarObjectPath(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  return path.startsWith(`${userId}/`) && !path.slice(userId.length + 1).includes("/") ? path : null;
}
