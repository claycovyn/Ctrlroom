// QA harness: next/navigation backed by the real History API. Navigation behaves like the App Router in production:
// a route whose data was prefetched ("full") commits at once; otherwise the loading state shows until the fake
// server answers (window.__serverMs, default 250 ms). Back/forward restore the route from the URL.
import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let path = location.pathname;
let search = location.search;
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

/** Route data: href → when it's ready (resolved promise = in the router cache). */
const ready = new Map<string, Promise<void>>();
const done = new Set<string>();
const W = window as unknown as { __serverMs?: number; __nav: { pushes: string[]; prefetches: string[] } };
W.__nav = { pushes: [], prefetches: [] };

function load(href: string): Promise<void> {
  const key = new URL(href, location.href).pathname;
  let p = ready.get(key);
  if (!p) {
    p = new Promise<void>((ok) => setTimeout(ok, W.__serverMs ?? 250)).then(() => {
      done.add(key);
      notify();
    });
    ready.set(key, p);
  }
  return p;
}
/** Whether a route's server data is in the cache (the harness page shows its loading state until it is). */
export function routeReady(p: string): boolean {
  return done.has(p);
}
export function ensureRoute(p: string): void {
  void load(p);
}
// The first page is server-rendered: its data is there.
done.add(path);

function go(href: string, replace: boolean) {
  const u = new URL(href, location.href);
  const state = { ...(history.state ?? {}), __NA: true };
  delete (state as Record<string, unknown>).crChat;
  if (u.pathname + u.search === location.pathname + location.search) return;
  if (replace) history.replaceState(state, "", u.pathname + u.search + u.hash);
  else history.pushState(state, "", u.pathname + u.search + u.hash);
  path = u.pathname;
  search = u.search;
  void load(u.pathname);
  notify();
}
window.addEventListener("popstate", () => {
  // Same page (the app's own history entries): Next restores the same tree, nothing re-renders.
  if (path === location.pathname && search === location.search) return;
  path = location.pathname;
  search = location.search;
  void load(path);
  notify();
});
if (!history.state?.__NA) history.replaceState({ ...(history.state ?? {}), __NA: true }, "", location.href);

const sub = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const usePathname = () => useSyncExternalStore(sub, () => path);
/** Changes whenever routing state does (route data arriving included). */
export const useRouteVersion = () => useSyncExternalStore(sub, () => version);
export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(sub, () => search));
export const useParams = () => ({});
const router = {
  push(href: string) {
    W.__nav.pushes.push(href);
    go(href, false);
  },
  replace(href: string) {
    go(href, true);
  },
  prefetch(href: string) {
    W.__nav.prefetches.push(href);
    void load(href);
  },
  refresh() {},
  back() {
    history.back();
  },
  forward() {
    history.forward();
  },
};
export const useRouter = () => router;
export function notFound(): never {
  throw new Error("notFound");
}
export function redirect(href: string): never {
  go(href, true);
  throw new Error("redirect");
}
