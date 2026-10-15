import { NextResponse } from "next/server";
import { safeFetchText } from "@/lib/agent/safeFetch";
import { parsePreview, previewableUrl, type LinkPreview } from "@/lib/linkPreview";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Previews are kept for a day per server instance (most links are shared more than once), at most 500 of them.
const cache = new Map<string, { at: number; preview: LinkPreview | null }>();
const DAY = 86_400_000;
// 120 new pages an hour per person, so the server can't be used to fetch pages in bulk.
const recent = new Map<string, number[]>();

function remember(url: string, preview: LinkPreview | null) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(url, { at: Date.now(), preview });
}

/** GET ?url=… → { preview } (null when the page has none or can't be read). Signed-in people only. */
export async function GET(request: Request) {
  const { user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const url = previewableUrl(new URL(request.url).searchParams.get("url"));
  if (!url) return NextResponse.json({ preview: null });
  const headers = { "Cache-Control": "private, max-age=86400" };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < DAY) return NextResponse.json({ preview: hit.preview }, { headers });
  const now = Date.now();
  const mine = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
  if (mine.length >= 120) return NextResponse.json({ preview: null }, { status: 429 });
  recent.set(user.id, [...mine, now]);
  let preview: LinkPreview | null = null;
  try {
    const page = await safeFetchText(url, { timeoutMs: 6_000, maxBytes: 400_000 });
    if (/html/i.test(page.contentType)) preview = parsePreview(page.body, page.url);
  } catch {
    preview = null;
  }
  remember(url, preview);
  return NextResponse.json({ preview }, { headers });
}
