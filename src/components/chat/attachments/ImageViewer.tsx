"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { altText, type Attachment } from "@/lib/attachments";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon } from "../icons";
import { download } from "./signedUrls";

/**
 * Full-screen image viewer: arrows (buttons and keys) or a swipe move between a message's images, Esc closes, and
 * pinch-zoom is the browser's own (a swipe only counts when the page isn't zoomed in).
 */
export function ImageViewer({
  images,
  start,
  urls,
  onClose,
}: {
  images: Attachment[];
  start: number;
  urls: Record<string, string | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(start);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const n = images.length;
  const a = images[Math.min(i, n - 1)];
  const go = (d: number) => setI((cur) => (n ? (cur + d + n) % n : 0));

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, []);

  if (!a) return null;
  const url = urls[a.path];
  const alt = altText(a.alt);

  return (
    <dialog
      ref={ref}
      aria-label={n > 1 ? `Image ${i + 1} of ${n}` : "Image"}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black/80"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && n > 1) {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft" && n > 1) {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      <div className="flex h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-white/80" title={a.name}>
            {n > 1 && <span className="mr-2 tabular-nums">{i + 1} / {n}</span>}
            {a.name}
          </p>
          <button type="button" className="rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => download(a)} aria-label={`Download ${a.name}`} title="Download">
            <DownloadIcon className="h-5 w-5" />
          </button>
          <button type="button" className="rounded p-2 text-white/80 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close" title="Close (Esc)" autoFocus>
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-2"
          style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
          onTouchStart={(e) => {
            touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
          }}
          onTouchEnd={(e) => {
            const t = touch.current;
            touch.current = null;
            if (!t || n < 2 || (window.visualViewport?.scale ?? 1) > 1.01) return;
            const dx = e.changedTouches[0].clientX - t.x;
            const dy = e.changedTouches[0].clientY - t.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.id} src={url} alt={alt} className="max-h-full max-w-full select-none object-contain" draggable={false} />
          ) : (
            <p className="text-sm text-white/70">{url === null ? "This image isn't available." : "Loading…"}</p>
          )}
          {n > 1 && (
            <>
              <button
                type="button"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/90 hover:bg-black/70 hover:text-white"
                onClick={() => go(-1)}
                aria-label="Previous image"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/90 hover:bg-black/70 hover:text-white"
                onClick={() => go(1)}
                aria-label="Next image"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        {a.alt && <p className="shrink-0 px-4 py-3 text-center text-sm text-white/80">{alt}</p>}
      </div>
    </dialog>
  );
}
