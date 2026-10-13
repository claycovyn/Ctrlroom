import { safeNext } from "@/lib/safeNext";

/** Same rule as sign-up (src/app/login/actions.ts). */
export const PASSWORD_MIN = 8;

/** The `type` values an email link can carry (Supabase's EmailOtpType). */
export const EMAIL_LINK_TYPES = ["signup", "email", "magiclink", "invite", "recovery", "email_change"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export function isEmailLinkType(v: unknown): v is EmailLinkType {
  return typeof v === "string" && (EMAIL_LINK_TYPES as readonly string[]).includes(v);
}

const AUTH_HOPS = new Set(["/auth/callback", "/auth/confirm"]);

/**
 * Where to go after an email link. Accepts a same-site relative path, or a full URL on one of `origins`
 * (the email templates pass `{{ .RedirectTo }}`, which Supabase fills with a full URL). A full URL that points
 * back at /auth/callback or /auth/confirm is unwrapped to its own `next`. Anything else gives `fallback`.
 */
export function resolveNext(raw: unknown, origins: string[], fallback = "/app", depth = 0): string {
  if (typeof raw !== "string" || !raw) return fallback;
  if (raw.startsWith("/")) {
    const path = safeNext(raw, fallback);
    if (path === fallback || depth > 1) return path;
    // A relative /auth/confirm?next=… still unwraps, so the result is never another hop.
    return unwrap(new URL(path, "http://x"), origins, fallback, depth);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (!origins.some((o) => sameOrigin(o, url))) return fallback;
  return unwrap(url, origins, fallback, depth);
}

function unwrap(url: URL, origins: string[], fallback: string, depth: number): string {
  if (AUTH_HOPS.has(url.pathname)) {
    return depth > 1 ? fallback : resolveNext(url.searchParams.get("next"), origins, fallback, depth + 1);
  }
  if (url.pathname === "/" && !url.search) return fallback;
  return safeNext(url.pathname + url.search + url.hash, fallback);
}

function sameOrigin(origin: string, url: URL): boolean {
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

/** Recovery and invite links end on the set-password page; the rest go straight to `next`. */
export function destinationFor(type: EmailLinkType | null, next: string): string {
  if (type === "recovery" || type === "invite") {
    return next === "/app" || next.startsWith("/auth/") ? "/auth/reset" : `/auth/reset?next=${encodeURIComponent(next)}`;
  }
  return next;
}

/** Words for the one-button confirm page. */
export function confirmCopy(type: EmailLinkType | null): { title: string; body: string; button: string } {
  switch (type) {
    case "recovery":
      return { title: "Reset your password", body: "Continue to choose a new password.", button: "Continue" };
    case "invite":
      return { title: "Accept your invite", body: "Continue to set a password for your account.", button: "Accept invite" };
    case "magiclink":
      return { title: "Sign in to Ctrl Room", body: "Use the button to finish signing in.", button: "Sign in" };
    case "email_change":
      return { title: "Confirm your new email", body: "Use the button to confirm the change.", button: "Confirm change" };
    case "signup":
      return { title: "Confirm your email", body: "Use the button to confirm your email and sign in.", button: "Confirm email" };
    default:
      // "email" is Supabase's type for both sign-up confirmation and sign-in links, so the words fit both.
      return { title: "Finish signing in", body: "One click and you're in.", button: "Continue" };
  }
}

/** Shown on /login?error=… and /forgot?error=… */
export const LINK_ERRORS: Record<string, string> = {
  link: "That link expired or was already used. Send a new one.",
  expired: "That reset link expired or was already used. Send a new one.",
};
