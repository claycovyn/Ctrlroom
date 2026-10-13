/**
 * The last room you had open, so the Home Screen app reopens there (start_url /app?launch=1). The browser keeps it in
 * localStorage (src/components/chat/roomNav.ts) and in a cookie, so the server can send a phone straight to the room
 * instead of rendering the communities list first and redirecting from the browser (two round trips on every launch).
 */
export const LAST_PLACE_COOKIE = "cr_last";

const PLACE = /^\/c\/[a-z0-9-]+(\/[a-z0-9-]+)?$/;

/** A path we'd send someone to: /c/<slug> or /c/<slug>/<room>, nothing else (never another site). */
export function validPlace(v: string | null | undefined): string | null {
  if (!v) return null;
  let p = v;
  try {
    p = decodeURIComponent(v);
  } catch {
    return null;
  }
  return PLACE.test(p) ? p : null;
}

/** The Set-Cookie value for document.cookie (a year, the whole site, never sent cross-site). */
export function lastPlaceCookie(place: string, secure: boolean): string {
  return `${LAST_PLACE_COOKIE}=${encodeURIComponent(place)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Phones (iPhone, Android phones), by user agent; the server can't see the screen. */
export const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i;

/** Where /app?launch=1 should go on the server, or null to show the communities list. */
export function launchTarget({ launch, userAgent, cookie }: { launch: string | undefined; userAgent: string | null; cookie: string | undefined }): string | null {
  if (launch !== "1" || !PHONE_UA.test(userAgent ?? "")) return null;
  return validPlace(cookie);
}
