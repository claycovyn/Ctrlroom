import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safeNext";
import { supabaseServer } from "@/lib/supabase/server";

// OAuth and PKCE (?code=) sign-ins. Email links with a token_hash belong to /auth/confirm, which works in any browser.
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("token_hash")) {
    const confirm = request.nextUrl.clone();
    confirm.pathname = "/auth/confirm";
    return NextResponse.redirect(confirm);
  }
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=link", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
