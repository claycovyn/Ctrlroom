"use client";

import { useEffect, useState } from "react";
import { SIGNED_URL_SECONDS, SignedUrlCache, type Attachment } from "@/lib/attachments";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Short-lived signed URLs for the private attachments bucket, cached in memory for the page's lifetime (each one
 * works for an hour; the cache drops it a minute early). Image URLs are fetched in batches for messages on screen.
 * Downloads ask for a URL with the `download` option, so Storage sends Content-Disposition: attachment.
 */
const cache = new SignedUrlCache();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Map<string, ((url: string | null) => void)[]>();

async function flush() {
  timer = null;
  const paths = cache.missing(queue);
  queue = [];
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data } = await supabaseBrowser().storage.from("attachments").createSignedUrls(chunk, SIGNED_URL_SECONDS);
    const got = new Map<string, string>();
    for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) got.set(row.path, row.signedUrl);
    for (const p of chunk) {
      const url = got.get(p) ?? null;
      if (url) cache.set(p, url);
      for (const done of waiting.get(p) ?? []) done(url);
      waiting.delete(p);
    }
  }
  // Anything that was already cached when the batch ran.
  for (const [p, list] of waiting) {
    const url = cache.get(p);
    if (url) {
      list.forEach((done) => done(url));
      waiting.delete(p);
    }
  }
}

/** A signed URL to show an image inline. Null when it can't be read (deleted, or no longer yours to see). */
export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    queue.push(path);
    timer ??= setTimeout(flush, 0);
  });
}

/** Signed URLs for these paths once `enabled` (the message is on screen). */
export function useSignedUrls(paths: string[], enabled: boolean): Record<string, string | null> {
  const key = paths.join("|");
  const [urls, setUrls] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(paths.map((p) => [p, cache.get(p)]).filter(([, u]) => u)),
  );
  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    for (const p of key.split("|")) {
      signedUrl(p).then((url) => live && setUrls((cur) => (cur[p] === url ? cur : { ...cur, [p]: url })));
    }
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return urls;
}

/** A signed URL that downloads the file under its original name. */
export async function downloadUrl(a: Pick<Attachment, "path" | "name">): Promise<string | null> {
  const k = SignedUrlCache.key(a.path, a.name);
  const hit = cache.get(k);
  if (hit) return hit;
  const { data } = await supabaseBrowser().storage.from("attachments").createSignedUrl(a.path, SIGNED_URL_SECONDS, { download: a.name });
  if (!data?.signedUrl) return null;
  cache.set(k, data.signedUrl);
  return data.signedUrl;
}

/** Starts a download without leaving the page. */
export async function download(a: Pick<Attachment, "path" | "name">): Promise<boolean> {
  const url = await downloadUrl(a);
  if (!url) return false;
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.download = a.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

/**
 * After a message is deleted (the database already removed its attachments), remove the bytes from Storage now
 * rather than waiting for the daily cleanup. Best effort: the cron gets anything left.
 */
export async function purgeAttachments(list: Pick<Attachment, "path">[] | null | undefined): Promise<void> {
  const paths = (list ?? []).map((a) => a.path);
  if (!paths.length) return;
  paths.forEach((p) => cache.forget(p));
  await supabaseBrowser().storage.from("attachments").remove(paths).catch(() => undefined);
}
