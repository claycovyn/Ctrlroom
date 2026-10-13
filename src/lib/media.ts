/** Images stored in a public Supabase Storage bucket: the checks the browser makes before uploading
 *  (Storage and the DB check them again). Shared by profile photos and community images. */

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(",");

const mb = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/** Why a file can't be used, or null when it's fine. */
export function imageFileProblem(file: { type: string; size: number }, maxBytes: number): string | null {
  if (!IMAGE_TYPES[file.type]) return "Use a PNG, JPEG or WebP image.";
  if (file.size > maxBytes) return `That image is over ${mb(maxBytes)}.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Where a new image goes: `<folder>/<random>.<ext>`. */
export function imagePath(folder: string, type: string, id: string = crypto.randomUUID()): string {
  return `${folder}/${id}.${IMAGE_TYPES[type] ?? "png"}`;
}

/** The object path inside `bucket` for a public URL directly in `folder`, or null (other buckets,
 *  folders or sites, built-in icons). Used to delete the old file on replace/remove. */
export function publicObjectPath(url: string | null | undefined, bucket: string, folder: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const rest = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : "";
  return rest && !rest.includes("/") && rest !== "." && rest !== ".." ? path : null;
}
