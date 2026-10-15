// Photos, videos and link previews in posts (supabase/migrations/0021_social_live.sql, src/app/api/link-preview).
import { prepareFile, readHead, SignedUrlCache, sniffType, type Prepared } from "./attachments";
import { tokenize } from "./format";

export const POST_MEDIA_BUCKET = "post-media";
export const MAX_POST_MEDIA = 4;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const POST_MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm";
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"]);

/** One photo or video of a post, as post_cards.media has it. */
export interface PostMediaItem {
  id: string;
  path: string;
  mime: string;
  width: number | null;
  height: number | null;
  alt: string;
}

export const isVideo = (mime: string) => mime.startsWith("video/");

/** What's wrong with a picked file for a post, or null. */
export function postMediaProblem(mime: string | null, size: number): string | null {
  if (!mime || !ALLOWED.has(mime)) return "Posts take photos (PNG, JPEG, WebP, GIF) and videos (MP4, WebM).";
  if (size <= 0) return "That file is empty.";
  if (isVideo(mime) ? size > MAX_VIDEO_BYTES : size > MAX_PHOTO_BYTES) return isVideo(mime) ? "Videos can be up to 50 MB." : "Photos can be up to 10 MB.";
  return null;
}

/** "3 of 4" style: how many more files a post can take, and the ones to keep from a pick. */
export function takeMedia<T>(picked: T[], already: number): { take: T[]; dropped: number } {
  const room = Math.max(0, MAX_POST_MEDIA - already);
  return { take: picked.slice(0, room), dropped: Math.max(0, picked.length - room) };
}

/** The layout of a post's media: one wide box, or a 2-column grid (3 = one tall on the left). */
export function mediaGrid(count: number): { cols: 1 | 2; tall: boolean } {
  return { cols: count <= 1 ? 1 : 2, tall: count === 3 };
}

/** The first http(s) link in a post's text, for its preview card. */
export function firstLink(body: string): string | null {
  for (const t of tokenize(body)) if (t.type === "link") return t.href;
  return null;
}

/** "example.com" from a link (without www.). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ── browser only ─────────────────────────

/**
 * A picked file, ready to upload: photos shrunk and stripped of location data (like chat attachments), GIFs and videos
 * as they are (videos with their size, read from the file).
 */
export async function preparePostMedia(file: File): Promise<Prepared> {
  const type = sniffType(await readHead(file), file.name);
  if (!type || !ALLOWED.has(type.mime)) throw new Error(postMediaProblem(null, file.size)!);
  if (!isVideo(type.mime)) {
    // Photos are shrunk to fit (GIFs must already be under 10 MB).
    const prepared = await prepareFile(file);
    const p = postMediaProblem(prepared.mime, prepared.blob.size);
    if (p) throw new Error(p);
    return prepared;
  }
  const tooBig = postMediaProblem(type.mime, file.size);
  if (tooBig) throw new Error(tooBig);
  const size = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth || null, height: v.videoHeight || null });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
  return { blob: file, name: file.name, mime: type.mime, ...size };
}

const urls = new SignedUrlCache();

/** Signed URLs (an hour) for post media paths, fetched together and cached for the page's life. */
export async function postMediaUrls(paths: string[], sign: (paths: string[]) => Promise<{ path: string | null; signedUrl: string | null }[]>): Promise<Map<string, string>> {
  const missing = urls.missing(paths);
  if (missing.length) {
    const signed = await sign(missing).catch(() => []);
    for (const s of signed) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return new Map(paths.map((p) => [p, urls.get(p) ?? ""]).filter((e): e is [string, string] => Boolean(e[1])));
}
