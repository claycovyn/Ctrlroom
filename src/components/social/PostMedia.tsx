"use client";

import { useEffect, useState } from "react";
import { isVideo, mediaGrid, POST_MEDIA_BUCKET, postMediaUrls, type PostMediaItem } from "@/lib/postMedia";
import { supabaseBrowser } from "@/lib/supabase/client";

/** A post's photos and videos: signed URLs (the bucket is private), one wide box or a 2-column grid. */
export function PostMedia({ media }: { media: PostMediaItem[] }) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = media.map((m) => m.path).join("|");
  useEffect(() => {
    if (!media.length) return;
    let live = true;
    void postMediaUrls(
      media.map((m) => m.path),
      async (paths) => (await supabaseBrowser().storage.from(POST_MEDIA_BUCKET).createSignedUrls(paths, 3600)).data ?? [],
    ).then((u) => live && setUrls(u));
    return () => {
      live = false;
    };
    // The paths decide; the array is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!media.length) return null;
  const { cols, tall } = mediaGrid(media.length);
  return (
    <div className={`mt-2 grid gap-1 overflow-hidden rounded-xl border border-line ${cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {media.map((m, i) => {
        const url = urls.get(m.path);
        const span = tall && i === 0 ? "row-span-2" : "";
        const ratio = media.length === 1 && m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined;
        const box = `relative bg-raised ${span} ${media.length === 1 ? "max-h-[32rem]" : "aspect-square"}`;
        if (isVideo(m.mime))
          return (
            <div key={m.id} className={box} style={ratio}>
              {url && <video src={url} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label={m.alt || "Video"} />}
            </div>
          );
        return (
          <a key={m.id} href={url || undefined} target="_blank" rel="noopener noreferrer" className={box} style={ratio} aria-label={m.alt ? `Open photo: ${m.alt}` : "Open photo"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url && <img src={url} alt={m.alt} loading="lazy" className="h-full w-full object-cover" />}
          </a>
        );
      })}
    </div>
  );
}
