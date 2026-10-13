// The sign-in and sign-up screens: which provider buttons show, in what order, and the words for the last attempt.
// Order, top to bottom: Continue with OpenCtrl, Continue with Google, then the email form under "or with email".
// Each button shows only when its provider is set up; with neither, the page is just the email form.
// Pure (no env reads here) so tests/signinProviders.test.ts can cover it; src/app/login/page.tsx passes the env in.

export type Provider = "openctrl" | "google";

/** Top to bottom. */
export const PROVIDER_ORDER: readonly Provider[] = ["openctrl", "google"];

export const PROVIDER_LABEL: Record<Provider, string> = {
  openctrl: "Continue with OpenCtrl",
  google: "Continue with Google",
};

export const PROVIDER_START: Record<Provider, string> = {
  openctrl: "/auth/openctrl/start",
  google: "/auth/google/start",
};

/** Google goes through Supabase Auth's own Google provider. The app can't see Supabase's provider settings, so the
 * operator turns the button on with CTRLROOM_GOOGLE_SIGNIN=1 once Google is enabled in Supabase. */
export function googleSigninEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CTRLROOM_GOOGLE_SIGNIN === "1";
}

const MESSAGES: Record<Provider, Record<string, string>> = {
  openctrl: {
    link: "You already have a Ctrl Room account with this email. Sign in with its password once to connect it to OpenCtrl.",
    cancelled: "Sign-in with OpenCtrl was cancelled.",
    expired: "That sign-in took too long or started somewhere else. Try again.",
    taken: "That OpenCtrl account is already connected to a different Ctrl Room account.",
    noemail: "OpenCtrl didn't share an email address, so we couldn't set up your account.",
    unverified: "Confirm your email with OpenCtrl first, then try again.",
    off: "Sign-in with OpenCtrl isn't set up on this server.",
    failed: "Couldn't sign you in with OpenCtrl. Try again, or use your email.",
  },
  google: {
    cancelled: "Sign-in with Google was cancelled.",
    expired: "That sign-in took too long or started somewhere else. Try again.",
    off: "Sign-in with Google isn't set up on this server.",
    failed: "Couldn't sign you in with Google. Try again, or use your email.",
  },
};

export interface ProviderNotice {
  text: string;
  /** "status" for the one that asks for the password next; everything else is an error. */
  role: "status" | "alert";
}

export interface ProviderView {
  /** Buttons to show, in order. */
  buttons: Provider[];
  /** True when at least one button shows: one "or with email" divider goes under the last one. */
  divider: boolean;
  notices: ProviderNotice[];
}

/**
 * What the provider area shows. `enabled` is which providers are set up; `results` are the ?openctrl= / ?google=
 * values from the last attempt. When an OpenCtrl sign-in found an existing account (`link`), the buttons step aside so
 * the person signs in with their password, which makes the link.
 */
export function providerView(enabled: Partial<Record<Provider, boolean>>, results: Partial<Record<Provider, string | undefined>> = {}): ProviderView {
  const notices: ProviderNotice[] = [];
  for (const p of PROVIDER_ORDER) {
    const r = results[p];
    const text = r ? MESSAGES[p][r] : undefined;
    if (text) notices.push({ text, role: p === "openctrl" && r === "link" ? "status" : "alert" });
  }
  const linking = results.openctrl === "link";
  const buttons = linking ? [] : PROVIDER_ORDER.filter((p) => enabled[p]);
  return { buttons, divider: buttons.length > 0, notices };
}

/** The start URL for a provider, keeping where to go afterwards. */
export function startHref(p: Provider, next: string): string {
  return `${PROVIDER_START[p]}?next=${encodeURIComponent(next)}`;
}

/** Marks /auth/callback URLs that came from "Continue with Google", so a failure comes back with Google's words. */
export const GOOGLE_VIA = "google";

/**
 * /auth/callback after Google: the result code for /login?google=, or null when there's a code to exchange.
 * Supabase sends `error=access_denied` when the person backs out on Google's screen.
 */
export function googleCallbackResult(params: { code: string | null; error: string | null }): "cancelled" | "failed" | null {
  if (params.error) return params.error === "access_denied" ? "cancelled" : "failed";
  return params.code ? null : "failed";
}

/** Where a failed Google attempt lands. */
export function googleFailureUrl(result: string, next: string): string {
  return `/login?google=${result}&next=${encodeURIComponent(next)}`;
}
