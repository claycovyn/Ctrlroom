"use client";

import { useEffect, useRef, useState } from "react";
import { altText, formatBytes, gridLayout, kindOf, singleBox, splitAttachments, typeOf, type Attachment } from "@/lib/attachments";
import { DownloadIcon } from "../icons";
import { FileKindIcon } from "./AttachmentTray";
import { ImageViewer } from "./ImageViewer";
import { download, useSignedUrls } from "./signedUrls";

/** Whether the element has come near the screen (then stays true). */
function useNearScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** A message's files: images inline (one at its own shape, several in a grid; tap to view), other files as cards. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] | null | undefined }) {
  const { images, files } = splitAttachments(attachments);
  const [ref, near] = useNearScreen<HTMLDivElement>();
  const urls = useSignedUrls(images.map((a) => a.path), near);
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length && !files.length) return null;
  const grid = gridLayout(images.length);

  return (
    <div ref={ref} className="mt-1.5 space-y-1.5">
      {images.length > 0 &&
        (grid.single ? (
          <ImageTile a={images[0]} url={urls[images[0].path]} onOpen={() => setOpen(0)} box={singleBox(images[0].width, images[0].height)} />
        ) : (
          <div
            className="grid max-w-[420px] gap-1 overflow-hidden rounded-lg"
            style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
          >
            {grid.tiles.map((t) => (
              <div key={images[t.index].id} style={{ gridColumn: `span ${t.span} / span ${t.span}` }} className={t.span > 1 ? "aspect-[2/1]" : "aspect-square"}>
                <ImageTile a={images[t.index]} url={urls[images[t.index].path]} onOpen={() => setOpen(t.index)} more={t.more} fill />
              </div>
            ))}
          </div>
        ))}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((a) => (
            <li key={a.id}>
              <FileCard a={a} />
            </li>
          ))}
        </ul>
      )}
      {open !== null && <ImageViewer images={images} start={open} urls={urls} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImageTile({
  a,
  url,
  onOpen,
  more = 0,
  fill = false,
  box,
}: {
  a: Attachment;
  url: string | null | undefined;
  onOpen: () => void;
  more?: number;
  fill?: boolean;
  box?: { width: number; height: number };
}) {
  const alt = altText(a.alt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative block overflow-hidden bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${fill ? "h-full w-full" : "max-w-full rounded-lg border border-line"}`}
      style={box ? { width: box.width, aspectRatio: `${box.width} / ${box.height}` } : undefined}
      aria-label={more ? `${alt}, and ${more} more. Open` : `${alt}. Open`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted">
          <FileKindIcon kind="image" className={url === null ? "h-6 w-6 opacity-60" : "h-6 w-6 animate-pulse opacity-40"} />
          {url === null && <span className="sr-only">Image not available</span>}
        </span>
      )}
      {more > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">+{more}</span>}
    </button>
  );
}

function FileCard({ a }: { a: Attachment }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const label = typeOf(a.mime)?.label ?? "File";
  return (
    <div className="flex max-w-[420px] items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-panel text-muted">
        <FileKindIcon kind={kindOf(a.mime)} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium" title={a.name}>
          {a.name}
        </span>
        <span className={`block truncate text-xs ${state === "failed" ? "text-alert" : "text-muted"}`}>
          {state === "failed" ? "Couldn't download. Try again." : `${formatBytes(a.size_bytes)} · ${label}`}
        </span>
      </span>
      <button
        type="button"
        className="btn-outline shrink-0 px-2.5 py-1 text-xs"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setState((await download(a)) ? "idle" : "failed");
        }}
        aria-label={`Download ${a.name}`}
      >
        <DownloadIcon className="h-3.5 w-3.5" /> Download
      </button>
    </div>
  );
}
