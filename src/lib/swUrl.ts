/**
 * The service worker's script URL. The version makes each deploy a new worker (see public/sw.js). Kept apart from
 * pushClient so the root layout (ServiceWorker.tsx) doesn't pull the Supabase client into every page.
 */
export function swUrl(): string {
  const v = process.env.NODE_ENV === "production" ? (process.env.NEXT_PUBLIC_BUILD_ID ?? "1") : "dev";
  return `/sw.js?v=${encodeURIComponent(v)}`;
}
