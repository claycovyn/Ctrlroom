import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safeNext";
import { GOOGLE_VIA, googleCallbackResult, googleFailureUrl } from "@/lib/signinProviders";
import { supabaseServer } from "@/lib/supabase/server";

// OAuth and PKCE (?code=) sign-ins. Email links with a token_hash belong to /auth/confirm, which works in any browser.
// "Continue with Google" comes back here with ?via=google, so a cancelled or failed attempt gets Google's words.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.has("token_hash")) {
    const confirm = request.nextUrl.clone();
    confirm.pathname = "/auth/confirm";
    return NextResponse.redirect(confirm);
  }
  const code = params.get("code");
  const next = safeNext(params.get("next"));
  const google = params.get("via") === GOOGLE_VIA;
  if (google) {
    const result = googleCallbackResult({ code, error: params.get("error") });
    if (result) return NextResponse.redirect(new URL(googleFailureUrl(result, next), request.url));
  }
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // No verifier cookie (started in another browser) or a stale code: both mean "try again".
      if (google) return NextResponse.redirect(new URL(googleFailureUrl("expired", next), request.url));
      return NextResponse.redirect(new URL("/login?error=link", request.url));
    }
  }
  return NextResponse.redirect(new URL(next, request.url));
}
