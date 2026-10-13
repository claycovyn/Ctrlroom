import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/env";
import { discover, openctrlConfig, startLogin, STATE_COOKIE, STATE_TTL_S } from "@/lib/openctrlLogin";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

/** "Continue with OpenCtrl": remembers this attempt in a signed cookie and sends the browser to OpenCtrl. */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const back = (code: string) => NextResponse.redirect(new URL(`/login?openctrl=${code}&next=${encodeURIComponent(next)}`, siteUrl()), 303);
  const config = openctrlConfig();
  if (!config) return back("off");
  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await discover(config.issuer)).authorization_endpoint;
  } catch (e) {
    console.error("[openctrl] discovery:", e instanceof Error ? e.message : e);
    return back("failed");
  }
  const start = startLogin(config, authorizationEndpoint, `${siteUrl()}/auth/openctrl/callback`, next);
  const res = NextResponse.redirect(start.url, 303);
  res.cookies.set(STATE_COOKIE, start.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/openctrl",
    maxAge: STATE_TTL_S,
  });
  return res;
}
