import { NextResponse } from "next/server";
import { safeFetchImage } from "@/lib/agent/safeFetch";
import { previewableUrl } from "@/lib/linkPreview";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET ?u=… → a link preview's picture, fetched by the server (public addresses only, PNG, JPEG, WebP or GIF, up to
 * 4 MB), so the linked site never sees who's looking. Signed-in people only.
 */
export async function GET(request: Request) {
  const { user } = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const url = previewableUrl(new URL(request.url).searchParams.get("u"));
  if (!url) return new NextResponse(null, { status: 404 });
  try {
    const img = await safeFetchImage(url);
    return new NextResponse(new Uint8Array(img.bytes), {
      headers: {
        "Content-Type": img.contentType,
        "Cache-Control": "private, max-age=86400",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
