/**
 * Crop and shrink an image in the browser so it fits an upload limit. The math at the top is pure (and tested in
 * tests/imageResize.test.ts); the browser part at the bottom decodes with createImageBitmap (which applies EXIF
 * orientation), draws the crop on a canvas and encodes WebP (JPEG where WebP can't be encoded).
 *
 * Crop geometry is in frame units: the frame is 1 wide and 1/aspect tall, its centre is (0, 0). At zoom 1 the
 * image just covers the frame; `x`/`y` is where the image centre sits relative to the frame centre.
 */

export type CropKind = "photo" | "icon" | "cover";

export interface CropTarget {
  /** Output width and height in pixels (also the frame's aspect ratio). */
  width: number;
  height: number;
}

export const CROP_TARGETS: Record<CropKind, CropTarget> = {
  photo: { width: 512, height: 512 },
  icon: { width: 512, height: 512 },
  cover: { width: 1600, height: 400 },
};

export const MAX_ZOOM = 4;
/** Quality steps tried at each size, best first. */
export const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.7, 0.6] as const;
/** Aim a little under the limit, so the bucket never sees a file right at the edge. */
export const LIMIT_HEADROOM = 0.95;
/** Files bigger than this aren't opened at all (decoding them can freeze a phone). */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

export const UNSUPPORTED_FORMAT = "This photo format isn't supported here. Try a JPEG or PNG.";
export const NOT_AN_IMAGE = "That file isn't a photo. Try a JPEG or PNG.";
export const TOO_BIG_TO_OPEN = "That file is too big to open (over 50 MB). Try a smaller photo.";
export const CANT_SHRINK = "Couldn't make that photo small enough. Try another one.";

export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const START_CROP: Crop = { zoom: 1, x: 0, y: 0 };

/** Frame height in frame units (width is 1). */
export const frameHeight = (target: Size) => target.height / target.width;

/** Frame units per image pixel at zoom 1: the smallest scale at which the image covers the whole frame. */
export function coverScale(image: Size, target: Size): number {
  return Math.max(1 / image.width, frameHeight(target) / image.height);
}

const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keeps the zoom in [1, MAX_ZOOM] and the image covering the frame (no empty edges). */
export function clampCrop(c: Crop, image: Size, target: Size): Crop {
  const zoom = clampNum(Number.isFinite(c.zoom) ? c.zoom : 1, 1, MAX_ZOOM);
  const s = coverScale(image, target) * zoom;
  const maxX = Math.max(0, (image.width * s - 1) / 2);
  const maxY = Math.max(0, (image.height * s - frameHeight(target)) / 2);
  return {
    zoom,
    x: clampNum(Number.isFinite(c.x) ? c.x : 0, -maxX, maxX),
    y: clampNum(Number.isFinite(c.y) ? c.y : 0, -maxY, maxY),
  };
}

/** Moves the image by (dx, dy) frame units. */
export function panCrop(c: Crop, dx: number, dy: number, image: Size, target: Size): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, image, target);
}

/** Zooms to `zoom`, keeping the image point under `at` (frame units from the centre) where it is. */
export function zoomCrop(c: Crop, zoom: number, image: Size, target: Size, at: { x: number; y: number } = { x: 0, y: 0 }): Crop {
  const next = clampNum(zoom, 1, MAX_ZOOM);
  const k = next / c.zoom;
  return clampCrop({ zoom: next, x: at.x - (at.x - c.x) * k, y: at.y - (at.y - c.y) * k }, image, target);
}

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The part of the image (in image pixels) that's inside the frame. */
export function cropRect(c: Crop, image: Size, target: Size): Rect {
  const k = clampCrop(c, image, target);
  const s = coverScale(image, target) * k.zoom;
  const sw = Math.min(image.width, 1 / s);
  const sh = Math.min(image.height, frameHeight(target) / s);
  const sx = clampNum(image.width / 2 - (0.5 + k.x) / s, 0, image.width - sw);
  const sy = clampNum(image.height / 2 - (frameHeight(target) / 2 + k.y) / s, 0, image.height - sh);
  return { sx, sy, sw, sh };
}

/** Output size for a crop: the target size, or smaller when the crop has fewer pixels (never upscale). */
export function outputSize(rect: Rect, target: Size): Size {
  const k = Math.min(1, rect.sw / target.width, rect.sh / target.height);
  return { width: Math.max(1, Math.round(target.width * k)), height: Math.max(1, Math.round(target.height * k)) };
}

export interface Encoded<B> {
  blob: B;
  width: number;
  height: number;
  quality: number;
}

/**
 * Tries each quality step at the start size, then shrinks the size by `shrink` and tries again, until a result is
 * at most LIMIT_HEADROOM × maxBytes. Throws CANT_SHRINK when even a tiny image is too big.
 */
export async function fitToLimit<B extends { size: number }>(
  start: Size,
  maxBytes: number,
  encode: (size: Size, quality: number) => Promise<B>,
  { shrink = 0.8, minSide = 64 }: { shrink?: number; minSide?: number } = {},
): Promise<Encoded<B>> {
  const budget = Math.floor(maxBytes * LIMIT_HEADROOM);
  let size = start;
  for (;;) {
    for (const quality of QUALITY_STEPS) {
      const blob = await encode(size, quality);
      if (blob.size > 0 && blob.size <= budget) return { blob, ...size, quality };
    }
    const next = { width: Math.round(size.width * shrink), height: Math.round(size.height * shrink) };
    if (Math.min(next.width, next.height) < Math.min(minSide, Math.min(start.width, start.height)) || next.width === size.width) {
      throw new Error(CANT_SHRINK);
    }
    size = next;
  }
}

/** Why a picked file can't be opened at all (before decoding), or null. */
export function pickProblem(file: { type: string; size: number; name?: string }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_INPUT_BYTES) return TOO_BIG_TO_OPEN;
  // Some systems give HEIC and other photos no type; let the browser try those.
  if (file.type && !file.type.startsWith("image/")) return NOT_AN_IMAGE;
  if (file.type === "image/svg+xml") return UNSUPPORTED_FORMAT;
  return null;
}

/** File name for an encoded image. */
export const encodedName = (type: string) => `image.${type === "image/webp" ? "webp" : "jpg"}`;

// ───────────────────────── browser only ─────────────────────────

/** Decodes a picked file, upright (EXIF orientation applied). Throws a plain message when the format won't open. */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(UNSUPPORTED_FORMAT);
  }
}

function canvas(size: Size): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size.width;
  c.height = size.height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the photo. Try again.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** Draws `rect` of the image at `size`, halving in steps for big reductions so the result stays sharp. */
export function drawCrop(image: CanvasImageSource, rect: Rect, size: Size, background?: string): HTMLCanvasElement {
  let src: CanvasImageSource = image;
  let r = rect;
  while (r.sw / 2 >= size.width && r.sh / 2 >= size.height) {
    const half = canvas({ width: Math.round(r.sw / 2), height: Math.round(r.sh / 2) });
    context(half).drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, half.width, half.height);
    src = half;
    r = { sx: 0, sy: 0, sw: half.width, sh: half.height };
  }
  const out = canvas(size);
  const ctx = context(out);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, size.width, size.height);
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

let webp: Promise<boolean> | null = null;
/** Whether this browser can encode WebP (Safari before 17 can't; it hands back a PNG). */
export function canEncodeWebP(): Promise<boolean> {
  webp ??= toBlob(canvas({ width: 2, height: 2 }), "image/webp", 0.8).then((b) => b?.type === "image/webp");
  return webp;
}

/** Crops, downsizes and compresses until it fits `maxBytes`. */
export async function cropToFile(image: ImageBitmap, crop: Crop, target: Size, maxBytes: number): Promise<File> {
  const rect = cropRect(crop, image, target);
  const type = (await canEncodeWebP()) ? "image/webp" : "image/jpeg";
  // JPEG has no transparency: put transparent parts on white instead of black.
  const background = type === "image/jpeg" ? "#ffffff" : undefined;
  let drawn: { key: string; canvas: HTMLCanvasElement } | null = null;
  const result = await fitToLimit(outputSize(rect, target), maxBytes, async (size, quality) => {
    const key = `${size.width}x${size.height}`;
    if (drawn?.key !== key) drawn = { key, canvas: drawCrop(image, rect, size, background) };
    const blob = await toBlob(drawn.canvas, type, quality);
    if (!blob) throw new Error("Couldn't prepare the photo. Try again.");
    return blob;
  });
  return new File([result.blob], encodedName(type), { type });
}
