import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/env";
import { safeNext } from "@/lib/safeNext";
import { GOOGLE_VIA, googleFailureUrl, googleSigninEnabled } from "@/lib/signinProviders";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * "Continue with Google", through Supabase Auth's own Google provider. Supabase keeps the PKCE verifier in a cookie on
 * this response and sends the browser to Google; Google returns to Supabase, which returns here to /auth/callback with
 * a code that the callback exchanges for the session.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const back = (code: string) => NextResponse.redirect(new URL(googleFailureUrl(code, next), siteUrl()), 303);
  if (!googleSigninEnabled()) return back("off");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback?via=${GOOGLE_VIA}&next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    console.error("[google] start:", error?.message ?? "no url");
    return back("failed");
  }
  return NextResponse.redirect(data.url, 303);
}
