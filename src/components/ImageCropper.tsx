"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  clampCrop,
  coverScale,
  CROP_TARGETS,
  cropToFile,
  decodeImage,
  drawCrop,
  frameHeight,
  MAX_ZOOM,
  panCrop,
  START_CROP,
  zoomCrop,
  type Crop,
  type CropKind,
  type Size,
} from "@/lib/imageResize";

const PREVIEW_MAX = 2048;
const STEP = 0.02;

/**
 * Crop a picked image to a fixed frame (1:1 for photos and icons, 4:1 for covers) before it's shrunk and uploaded.
 * Drag (mouse, pen or one finger) to move, pinch / wheel / the slider to zoom; with the frame focused, arrow keys
 * move (Shift for bigger steps) and + / - zoom. Escape or Cancel closes without uploading.
 */
export function ImageCropper({
  file,
  kind,
  maxBytes,
  title,
  round = false,
  onCancel,
  onDone,
}: {
  file: File;
  kind: CropKind;
  maxBytes: number;
  title: string;
  /** Show a round preview (profile photos); the saved image is still square. */
  round?: boolean;
  /** `error` is set when the file couldn't be opened. */
  onCancel: (error?: string) => void;
  onDone: (file: File) => void | Promise<void>;
}) {
  const uid = useId();
  const target = CROP_TARGETS[kind];
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>(START_CROP);
  const [framePx, setFramePx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const image: Size | null = bitmap ? { width: bitmap.width, height: bitmap.height } : null;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Decode once (upright, EXIF applied); a downsized copy is the preview texture.
  useEffect(() => {
    let live = true;
    let bmp: ImageBitmap | null = null;
    decodeImage(file).then(
      (b) => {
        if (!live) return b.close();
        bmp = b;
        setBitmap(b);
      },
      (e: Error) => live && onCancel(e.message),
    );
    return () => {
      live = false;
      bmp?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const c = preview.current;
    if (!bitmap || !c) return;
    const k = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
    const size = { width: Math.max(1, Math.round(bitmap.width * k)), height: Math.max(1, Math.round(bitmap.height * k)) };
    const drawn = drawCrop(bitmap, { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height }, size);
    c.width = size.width;
    c.height = size.height;
    c.getContext("2d")?.drawImage(drawn, 0, 0);
  }, [bitmap]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFramePx(el.clientWidth));
    ro.observe(el);
    setFramePx(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /** A point on screen in frame units from the frame centre. */
  const toFrame = useCallback(
    (clientX: number, clientY: number) => {
      const r = frame.current?.getBoundingClientRect();
      if (!r || !r.width) return { x: 0, y: 0 };
      return { x: (clientX - r.left - r.width / 2) / r.width, y: (clientY - r.top - r.height / 2) / r.width };
    },
    [],
  );

  const zoomTo = useCallback(
    (z: number, at?: { x: number; y: number }) => image && setCrop((c) => zoomCrop(c, z, image, target, at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bitmap, target],
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el || !image) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toFrame(e.clientX, e.clientY);
      setCrop((c) => zoomCrop(c, c.zoom * Math.exp(-e.deltaY * 0.0015), image, target, at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitmap, target, toFrame]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!image || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: crop.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !image || !framePx) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const at = toFrame((a.x + b.x) / 2, (a.y + b.y) / 2);
      const z = (pinch.current.zoom * dist) / pinch.current.dist;
      // Half the finger movement pans (the midpoint moves for both fingers).
      setCrop((c) => panCrop(zoomCrop(c, z, image, target, at), (next.x - prev.x) / framePx / 2, (next.y - prev.y) / framePx / 2, image, target));
    } else {
      setCrop((c) => panCrop(c, (next.x - prev.x) / framePx, (next.y - prev.y) / framePx, image, target));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!image) return;
    const step = e.shiftKey ? STEP * 5 : STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      // Arrows move the crop window the way they point (the picture slides the other way).
      const [dx, dy] = moves[e.key];
      setCrop((c) => panCrop(c, dx, dy, image, target));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(crop.zoom * 1.1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomTo(crop.zoom / 1.1);
    } else if (e.key === "0") {
      e.preventDefault();
      setCrop(START_CROP);
    }
  };

  const use = async () => {
    if (!bitmap || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await cropToFile(bitmap, crop, target, maxBytes);
      await onDone(out);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't prepare the photo. Try again.");
      setBusy(false);
    }
  };

  // Where the preview sits, in frame pixels.
  const fh = frameHeight(target);
  let style: React.CSSProperties = { visibility: "hidden" };
  if (image && framePx) {
    const c = clampCrop(crop, image, target);
    const s = coverScale(image, target) * c.zoom * framePx;
    const w = image.width * s;
    const h = image.height * s;
    const left = framePx / 2 + c.x * framePx - w / 2;
    const top = (fh * framePx) / 2 + c.y * framePx - h / 2;
    style = { width: w, height: h, transform: `translate3d(${left}px, ${top}px, 0)` };
  }

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-help`}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-0 text-fg backdrop:bg-black/70"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <h2 id={`${uid}-title`} className="min-w-0 truncate font-semibold">
            {title}
          </h2>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          <div className={kind === "cover" ? "" : "mx-auto max-w-[20rem]"}>
            <div
              ref={frame}
              role="group"
              tabIndex={0}
              aria-label="Crop area"
              aria-describedby={`${uid}-help`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className={`relative w-full cursor-grab touch-none select-none overflow-hidden rounded-lg bg-raised outline-none focus-visible:ring-2 focus-visible:ring-signal active:cursor-grabbing ${
                kind === "cover" ? "aspect-[4/1]" : "aspect-square"
              }`}
            >
              <canvas ref={preview} className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left" style={style} />
              {round && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-1 ring-white/60" />
              )}
              {!round && <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/30" />}
              {!bitmap && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Opening…</p>}
            </div>
          </div>
          <div className="mx-auto mt-4 flex max-w-[20rem] items-center gap-3">
            <button type="button" className="btn-ghost px-2 py-1" onClick={() => zoomTo(crop.zoom / 1.2)} disabled={!bitmap || busy} aria-label="Zoom out">
              −
            </button>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={(e) => zoomTo(Number(e.target.value))}
              disabled={!bitmap || busy}
              aria-label="Zoom"
              aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
              className="min-w-0 flex-1 accent-signal"
            />
            <button type="button" className="btn-ghost px-2 py-1" onClick={() => zoomTo(crop.zoom * 1.2)} disabled={!bitmap || busy} aria-label="Zoom in">
              +
            </button>
          </div>
          <p id={`${uid}-help`} className="mt-3 text-center text-xs text-muted">
            Drag to move, pinch or scroll to zoom. With the photo focused, use the arrow keys and + / −.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-center text-sm text-alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn-ghost" onClick={() => onCancel()} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={use} disabled={!bitmap || busy}>
            {busy ? "Saving…" : "Use photo"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
