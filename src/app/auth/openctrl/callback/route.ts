import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/env";
import { accountByEmail, createAccount, emailOf, link, linkedSubOf, linkedUserId, signInAs } from "@/lib/openctrlBridge";
import { decideLogin, finishLogin, LINK_COOKIE, openCookie, openctrlConfig, sealCookie, STATE_COOKIE, type PendingLogin } from "@/lib/openctrlLogin";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = openctrlConfig();
  const pending = config ? openCookie<PendingLogin>(config.clientSecret, "oc-state", request.cookies.get(STATE_COOKIE)?.value) : null;
  const next = pending?.next ?? "/app";
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, siteUrl()), 303);
    res.cookies.set(STATE_COOKIE, "", { path: "/auth/openctrl", maxAge: 0 });
    return res;
  };
  const back = (code: string) => go(`/login?openctrl=${code}&next=${encodeURIComponent(next)}`);

  if (!config) return back("off");
  const params = request.nextUrl.searchParams;
  // No cookie or a different state: this callback didn't start here (or took over 10 minutes). Never continue.
  if (!pending || params.get("state") !== pending.state) return back("expired");
  const error = params.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");
  // RFC 9207: the response must say it came from our issuer.
  const iss = params.get("iss");
  if (iss && iss !== config.issuer) return back("failed");
  const code = params.get("code");
  if (!code) return back("failed");

  try {
    const claims = await finishLogin(config, pending, code, `${siteUrl()}/auth/openctrl/callback`);
    const email = claims.email?.trim().toLowerCase();
    const { user } = await currentUser();
    const [linked, byEmail, currentSub] = await Promise.all([
      linkedUserId(claims.sub),
      email ? accountByEmail(email) : null,
      user ? linkedSubOf(user.id) : null,
    ]);
    const byEmailSub = byEmail ? await linkedSubOf(byEmail.id) : null;
    const decision = decideLogin(
      { ...claims, email },
      linked,
      byEmail && { ...byEmail, linkedSub: byEmailSub },
      user && { id: user.id, linkedSub: currentSub },
    );

    switch (decision.kind) {
      case "login": {
        const to = await emailOf(decision.userId);
        if (!to) return back("failed");
        await signInAs(to);
        return go(next);
      }
      case "link": {
        if (!(await link(decision.userId, claims.sub))) return back("taken");
        // Already signed in (connecting from settings): keep that session. Otherwise sign in as the linked account.
        if (!user) await signInAs((await emailOf(decision.userId))!);
        return go(next);
      }
      case "create": {
        const id = await createAccount(email!, claims.name);
        await link(id, claims.sub);
        await signInAs(email!);
        return go(next);
      }
      case "confirm-password": {
        // Remember who OpenCtrl vouched for; signing in with this account's password links them (login/actions.ts).
        const res = back("link");
        res.cookies.set(LINK_COOKIE, sealCookie(config.clientSecret, "oc-link", { sub: claims.sub, email: decision.email }, 10 * 60), {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 10 * 60,
        });
        return res;
      }
      default:
        return back(decision.code);
    }
  } catch (e) {
    console.error("[openctrl] sign-in:", e instanceof Error ? e.message : e);
    return back("failed");
  }
}
