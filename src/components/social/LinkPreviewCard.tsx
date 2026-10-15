"use client";

import { useEffect, useState } from "react";
import type { LinkPreview } from "@/lib/linkPreview";
import { domainOf } from "@/lib/postMedia";

// One request per link for the page's life (the server caches it for a day too).
const cache = new Map<string, Promise<LinkPreview | null>>();

function load(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : { preview: null }))
      .then((j: { preview: LinkPreview | null }) => j.preview)
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** The card under a post with a link: the page's picture, title, description and site. Nothing when it has none. */
export function LinkPreviewCard({ url, compact = false }: { url: string; compact?: boolean }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    void load(url).then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [url]);
  if (!preview) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="mt-2 block overflow-hidden rounded-xl border border-line transition-colors hover:border-signal">
      {preview.image && !compact && (
        // The picture comes through our server, so the site doesn't see who's looking.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/link-preview/image?u=${encodeURIComponent(preview.image)}`} alt="" loading="lazy" className="max-h-64 w-full bg-raised object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
      <span className="block px-3 py-2">
        <span className="block text-xs text-muted">{preview.site || domainOf(url)}</span>
        <span className="block font-medium leading-snug [overflow-wrap:anywhere]">{preview.title}</span>
        {preview.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{preview.description}</span>}
      </span>
    </a>
  );
}
