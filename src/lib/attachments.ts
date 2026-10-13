/**
 * Files and images in chat (supabase/migrations/0013_attachments.sql). The top half is pure and unit-tested in
 * tests/attachments.test.ts: the allowed types (the same list as the database), content sniffing, limits, the image
 * grid and the signed URL cache. The bottom half runs in the browser: shrinking images and uploading with progress.
 *
 * Limits are enforced by the database and the Storage bucket; the numbers here only let the app say no sooner.
 */

/** Per file, after images are shrunk. The bucket and the database refuse anything bigger. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Per message (database: link_attachments). */
export const MAX_FILES = 10;
/**
 * Each person's total for files in direct messages (DMs aren't metered by a community). The database default is in
 * attachment_dm_cap_bytes() (0013); an operator can change it with `alter database postgres set
 * ctrlroom.dm_files_cap_mb = '1000'`. Keep this in step with the default; the database decides.
 */
export const DM_CAP_BYTES = 500 * 1024 * 1024;
/** Photos are shrunk so the long edge is at most this, then saved as WebP (JPEG where WebP can't be encoded). */
export const IMAGE_LONG_EDGE = 2560;
/** How long a signed URL works. Fetched for messages on screen, kept in memory until a little before it ends. */
export const SIGNED_URL_SECONDS = 60 * 60;
/** Files bigger than this aren't opened in the browser at all. */
export const MAX_PICK_BYTES = 50 * 1024 * 1024;

export type FileKind = "image" | "pdf" | "text" | "archive" | "doc" | "sheet" | "slides" | "audio" | "video";

export interface FileType {
  mime: string;
  kind: FileKind;
  /** The first is the one used when the app names a file (a shrunk photo becomes .webp). */
  exts: string[];
  label: string;
}

/** The same list as attachment_ext_mime() in 0013 and the bucket's allowed types. SVG and HTML are never here. */
export const FILE_TYPES: FileType[] = [
  { mime: "image/png", kind: "image", exts: ["png"], label: "PNG image" },
  { mime: "image/jpeg", kind: "image", exts: ["jpg", "jpeg"], label: "JPEG image" },
  { mime: "image/webp", kind: "image", exts: ["webp"], label: "WebP image" },
  { mime: "image/gif", kind: "image", exts: ["gif"], label: "GIF" },
  { mime: "application/pdf", kind: "pdf", exts: ["pdf"], label: "PDF" },
  { mime: "text/plain", kind: "text", exts: ["txt"], label: "Text" },
  { mime: "text/markdown", kind: "text", exts: ["md", "markdown"], label: "Markdown" },
  { mime: "text/csv", kind: "sheet", exts: ["csv"], label: "CSV" },
  { mime: "application/zip", kind: "archive", exts: ["zip"], label: "ZIP archive" },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "doc", exts: ["docx"], label: "Word document" },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "sheet", exts: ["xlsx"], label: "Excel sheet" },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "slides", exts: ["pptx"], label: "PowerPoint" },
  { mime: "audio/mpeg", kind: "audio", exts: ["mp3"], label: "MP3 audio" },
  { mime: "audio/mp4", kind: "audio", exts: ["m4a"], label: "M4A audio" },
  { mime: "audio/ogg", kind: "audio", exts: ["ogg", "oga"], label: "Ogg audio" },
  { mime: "audio/wav", kind: "audio", exts: ["wav"], label: "WAV audio" },
  { mime: "video/mp4", kind: "video", exts: ["mp4"], label: "MP4 video" },
  { mime: "video/webm", kind: "video", exts: ["webm"], label: "WebM video" },
];

/** For the file picker's accept attribute. */
export const ACCEPT = FILE_TYPES.flatMap((t) => [t.mime, ...t.exts.map((e) => `.${e}`)]).join(",");

const BY_EXT = new Map(FILE_TYPES.flatMap((t) => t.exts.map((e) => [e, t] as const)));
const BY_MIME = new Map(FILE_TYPES.map((t) => [t.mime, t]));

export const NOT_ALLOWED = "That type of file can't be sent. Try an image, PDF, document, audio or video.";
export const TOO_BIG = "Files can be up to 10 MB.";
export const TOO_MANY = `A message can have up to ${MAX_FILES} files.`;
export const EMPTY_FILE = "That file is empty.";

export function extOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

export function typeOf(mime: string): FileType | undefined {
  return BY_MIME.get(mime);
}

export function kindOf(mime: string): FileKind {
  return BY_MIME.get(mime)?.kind ?? "doc";
}

export const isImage = (mime: string) => kindOf(mime) === "image";

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * What a file really is, from its first bytes (at least 16) and its name. Returns the allowed type or null.
 * The bytes win over the name for images, PDF, audio and video (a .png that's really a JPEG is a JPEG); ZIP-based
 * Office files and plain text go by the extension once the bytes agree. SVG and HTML are refused, whatever the name.
 */
export function sniffType(head: Uint8Array, name: string): FileType | null {
  const ext = extOf(name);
  const byExt = ext ? BY_EXT.get(ext) : undefined;
  const t = (mime: string) => BY_MIME.get(mime) ?? null;
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, "PNG")) return t("image/png");
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return t("image/jpeg");
  if (ascii(head, 0, "GIF8")) return t("image/gif");
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return t("image/webp");
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WAVE")) return t("audio/wav");
  if (ascii(head, 0, "%PDF-")) return t("application/pdf");
  if (ascii(head, 0, "OggS")) return t("audio/ogg");
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return t("video/webm");
  if (ascii(head, 4, "ftyp")) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (brand.startsWith("M4A") || ext === "m4a") return t("audio/mp4");
    return t("video/mp4");
  }
  if (ascii(head, 0, "ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && ext === "mp3")) return t("audio/mpeg");
  if (ascii(head, 0, "PK\x03\x04") || ascii(head, 0, "PK\x05\x06")) {
    return byExt && (byExt.kind === "doc" || byExt.kind === "sheet" || byExt.kind === "slides" || byExt.kind === "archive") && byExt.mime !== "text/csv"
      ? byExt
      : t("application/zip");
  }
  // Text: no NUL bytes, named as text, and not markup a browser would run.
  if (byExt && (byExt.mime.startsWith("text/")) && !head.includes(0)) {
    const start = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart().toLowerCase();
    if (/^<(\?xml|svg|!doctype html|html|script)/.test(start)) return null;
    return byExt;
  }
  return null;
}

/** Why a picked file can't be added, before reading it (null when it can). */
export function pickProblem(file: { size: number; name: string }, alreadyAttached: number): string | null {
  if (alreadyAttached >= MAX_FILES) return TOO_MANY;
  if (file.size === 0) return EMPTY_FILE;
  if (file.size > MAX_PICK_BYTES) return TOO_BIG;
  const ext = extOf(file.name);
  if (ext === "svg" || ext === "svgz" || ext === "html" || ext === "htm" || ext === "xhtml") return NOT_ALLOWED;
  return null;
}

/** Why a prepared file (images already shrunk) can't be uploaded, or null. GIFs aren't shrunk, so they must fit. */
export function sizeProblem(bytes: number): string | null {
  if (bytes <= 0) return EMPTY_FILE;
  return bytes > MAX_FILE_BYTES ? TOO_BIG : null;
}

/** How many of the picked files fit in the message, and what to say about the rest. */
export function takeFiles<T>(picked: T[], alreadyAttached: number): { take: T[]; dropped: number; message: string | null } {
  const room = Math.max(0, MAX_FILES - alreadyAttached);
  const take = picked.slice(0, room);
  const dropped = picked.length - take.length;
  return { take, dropped, message: dropped > 0 ? `${TOO_MANY} ${dropped === 1 ? "One file was" : `${dropped} files were`} left out.` : null };
}

/** The name a file is sent under: a shrunk photo gets its new extension; otherwise the extension the type expects. */
export function sendName(name: string, type: FileType): string {
  const clean = name.replace(/[\u0000-\u001f/\\]+/g, "").trim() || "file";
  const ext = extOf(clean);
  if (ext && type.exts.includes(ext)) return clean;
  const stem = ext ? clean.slice(0, -(ext.length + 1)) : clean;
  return `${stem || "file"}.${type.exts[0]}`;
}

/** Fits a size inside a long edge, never upscaling. */
export function fitLongEdge(size: { width: number; height: number }, longEdge = IMAGE_LONG_EDGE): { width: number; height: number } {
  const k = Math.min(1, longEdge / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Alt text for an image: the sender's description, or "Image". */
export function altText(alt: string | null | undefined): string {
  const a = (alt ?? "").trim();
  return a || "Image";
}

export const MAX_ALT = 300;

// ── what a message carries (0013 attachments_json)

/** Select for messages and dm_messages with their attachments embedded. */
export const WITH_ATTACHMENTS = "*, attachments:message_attachments(id, path, name, mime, size_bytes, width, height, alt, position)";

export interface Attachment {
  id: string;
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  position: number;
}

export function sortAttachments(list: Attachment[] | null | undefined): Attachment[] {
  return [...(list ?? [])].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
}

export function splitAttachments(list: Attachment[] | null | undefined): { images: Attachment[]; files: Attachment[] } {
  const sorted = sortAttachments(list);
  return { images: sorted.filter((a) => isImage(a.mime)), files: sorted.filter((a) => !isImage(a.mime)) };
}

// ── the image grid

export interface GridTile {
  /** Index into the images. */
  index: number;
  /** Columns this tile spans (of `columns`). */
  span: number;
  /** "+3" on the last tile when more images are hidden. */
  more: number;
}

export interface GridLayout {
  columns: number;
  tiles: GridTile[];
  /** One image shows at its own aspect ratio; grids use square tiles. */
  single: boolean;
}

/** Up to 6 tiles: 1 alone, 2 side by side, 3 as one wide + two, 4 as 2×2, 5–6 in rows of 3; the 6th says "+N". */
export function gridLayout(count: number): GridLayout {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return { columns: 1, tiles: [], single: false };
  if (n === 1) return { columns: 1, tiles: [{ index: 0, span: 1, more: 0 }], single: true };
  if (n === 2) return { columns: 2, tiles: [0, 1].map((index) => ({ index, span: 1, more: 0 })), single: false };
  if (n === 3) return { columns: 2, tiles: [{ index: 0, span: 2, more: 0 }, { index: 1, span: 1, more: 0 }, { index: 2, span: 1, more: 0 }], single: false };
  if (n === 4) return { columns: 2, tiles: [0, 1, 2, 3].map((index) => ({ index, span: 1, more: 0 })), single: false };
  const shown = Math.min(n, 6);
  return {
    columns: 3,
    tiles: Array.from({ length: shown }, (_, index) => ({ index, span: n === 5 && index < 2 ? (index === 0 ? 2 : 1) : 1, more: index === shown - 1 ? n - shown : 0 })),
    single: false,
  };
}

/** Box for a single image: its own aspect ratio, at most maxW × maxH, never larger than the picture. */
export function singleBox(width: number | null, height: number | null, maxW = 360, maxH = 320): { width: number; height: number } {
  const w = width && width > 0 ? width : 4;
  const h = height && height > 0 ? height : 3;
  const k = Math.min(maxW / w, maxH / h, width && height ? 1 : Infinity);
  return { width: Math.max(48, Math.round(w * k)), height: Math.max(48, Math.round(h * k)) };
}

// ── signed URLs

/** In-memory cache of signed URLs by path (and download name), dropped a minute before they stop working. */
export class SignedUrlCache {
  private map = new Map<string, { url: string; until: number }>();
  constructor(private margin = 60_000) {}
  static key(path: string, download?: string | null) {
    return download ? `${path}\n${download}` : path;
  }
  get(key: string, now = Date.now()): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.until - this.margin <= now) {
      this.map.delete(key);
      return null;
    }
    return hit.url;
  }
  set(key: string, url: string, seconds = SIGNED_URL_SECONDS, now = Date.now()) {
    this.map.set(key, { url, until: now + seconds * 1000 });
  }
  /** The keys without a live URL. */
  missing(keys: string[], now = Date.now()): string[] {
    return [...new Set(keys)].filter((k) => this.get(k, now) === null);
  }
  forget(prefixPath: string) {
    for (const k of this.map.keys()) if (k === prefixPath || k.startsWith(`${prefixPath}\n`)) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
}

// ── browser only ─────────────────────────

/** Reads the first bytes of a file for sniffType. */
export async function readHead(file: Blob, n = 64): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

export interface Prepared {
  blob: Blob;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
}

/**
 * Turns a picked file into what gets uploaded: the real type from its bytes; photos (PNG, JPEG, WebP) shrunk to
 * IMAGE_LONG_EDGE and saved as WebP, which also drops their location and camera data; GIFs kept as they are.
 */
export async function prepareFile(file: File): Promise<Prepared> {
  const type = sniffType(await readHead(file), file.name);
  if (!type) throw new Error(NOT_ALLOWED);
  if (type.kind === "image" && type.mime !== "image/gif") {
    const { decodeImage, drawCrop, fitToLimit, canEncodeWebP } = await import("./imageResize");
    const bitmap = await decodeImage(file);
    try {
      const start = fitLongEdge({ width: bitmap.width, height: bitmap.height });
      const mime = (await canEncodeWebP()) ? "image/webp" : "image/jpeg";
      const background = mime === "image/jpeg" ? "#ffffff" : undefined;
      const rect = { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
      let drawn: { key: string; canvas: HTMLCanvasElement } | null = null;
      const out = await fitToLimit(start, MAX_FILE_BYTES, async (size, quality) => {
        const key = `${size.width}x${size.height}`;
        if (drawn?.key !== key) drawn = { key, canvas: drawCrop(bitmap, rect, size, background) };
        const blob = await new Promise<Blob | null>((resolve) => drawn!.canvas.toBlob(resolve, mime, quality));
        if (!blob) throw new Error("Couldn't prepare the photo. Try again.");
        return blob;
      });
      const t = typeOf(mime)!;
      return { blob: out.blob, name: sendName(file.name, t), mime, width: out.width, height: out.height };
    } finally {
      bitmap.close?.();
    }
  }
  const problem = sizeProblem(file.size);
  if (problem) throw new Error(problem);
  let width: number | null = null;
  let height: number | null = null;
  if (type.mime === "image/gif") {
    try {
      const b = await createImageBitmap(file);
      width = b.width;
      height = b.height;
      b.close?.();
    } catch {
      /* size unknown is fine */
    }
  }
  return { blob: file, name: sendName(file.name, type), mime: type.mime, width, height };
}

export interface UploadHandle {
  done: Promise<void>;
  abort: () => void;
}

/**
 * Uploads to the attachments bucket with the person's session, reporting progress (0–1). Uses the Storage REST
 * endpoint directly because supabase-js has no upload progress. `x-upsert` lets a failed upload be retried.
 */
export function uploadWithProgress(o: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  path: string;
  blob: Blob;
  mime: string;
  onProgress: (fraction: number) => void;
}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const url = `${o.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/attachments/${o.path.split("/").map(encodeURIComponent).join("/")}`;
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${o.accessToken}`);
    xhr.setRequestHeader("apikey", o.anonKey);
    xhr.setRequestHeader("content-type", o.mime);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) o.onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(uploadError(xhr.status, xhr.responseText))));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload canceled", "AbortError"));
    xhr.send(o.blob);
  });
  return { done, abort: () => xhr.abort() };
}

export function uploadError(status: number, body: string): string {
  if (status === 413 || /too large|exceeded the maximum/i.test(body)) return TOO_BIG;
  if (status === 415 || /mime type|invalid_mime/i.test(body)) return NOT_ALLOWED;
  if (status === 401 || status === 403) return "You can't upload here anymore. Remove the file and try again.";
  return "Upload failed. Try again.";
}
