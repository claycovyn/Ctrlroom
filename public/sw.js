/* Ctrl Room service worker (registered by src/components/ServiceWorker.tsx as /sw.js?v=<build id>, scope /).
 *
 * Caching. Only same-origin GETs, and never anything with a person's data in it:
 *   /_next/static/*                  cache first (file names are content hashes, so they never change)
 *   /sounds/*, /brand/*, app icons   cache first
 *   /manifest.webmanifest            stale while revalidate
 *   page loads (HTML)                network only; the offline page when the network is gone. Pages are never stored:
 *                                    they're rendered for the signed-in person.
 *   /api/*, /auth/*, RSC requests, Supabase (another origin)   not touched
 * Each build has its own caches (the ?v= in the script URL); older ones are deleted when this worker takes over.
 * A new worker waits until the app says "Reload" (message SKIP_WAITING), so a deploy never swaps code mid-message.
 *
 * Push. Shows what /api/push/dispatch sends (src/lib/push.ts buildPayload): { title, body, url, tag, kind, at }.
 * Tapping a notification focuses an open Ctrl Room window and goes to its url, or opens one.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const DEV = VERSION === "dev";
const STATIC = `cr-static-${VERSION}`;
const ASSETS = `cr-assets-${VERSION}`;
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/brand/ctrlroom-icon-192.png", "/brand/ctrlroom-badge-96.png", "/manifest.webmanifest"];
const ICON = "/brand/ctrlroom-icon-192.png";
const BADGE = "/brand/ctrlroom-badge-96.png";

self.addEventListener("install", (event) => {
  if (DEV) return;
  event.waitUntil(caches.open(ASSETS).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = DEV ? [] : [STATIC, ASSETS];
      for (const key of await caches.keys()) {
        if (key.startsWith("cr-") && !keep.includes(key)) await caches.delete(key);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function cacheFirst(event, cacheName) {
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok && res.type === "basic") cache.put(event.request, res.clone()).catch(() => {});
      return res;
    })(),
  );
}

function staleWhileRevalidate(event, cacheName) {
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(event.request);
      const fresh = fetch(event.request)
        .then((res) => {
          if (res.ok && res.type === "basic") cache.put(event.request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => hit);
      if (hit) {
        event.waitUntil(fresh.then(() => undefined));
        return hit;
      }
      return fresh;
    })(),
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (DEV || req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/auth/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(req);
        } catch {
          return (await caches.match(OFFLINE)) || Response.error();
        }
      })(),
    );
    return;
  }
  // App Router data requests carry the signed-in person's page: never cached.
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (path.startsWith("/_next/static/")) return cacheFirst(event, STATIC);
  if (
    path.startsWith("/sounds/") ||
    path.startsWith("/brand/") ||
    path === "/icon.png" ||
    path === "/apple-icon.png" ||
    /\.(woff2?|ttf)$/.test(path)
  ) {
    return cacheFirst(event, ASSETS);
  }
  if (path === "/manifest.webmanifest") return staleWhileRevalidate(event, ASSETS);
});

// ───────────────────────── push ─────────────────────────

function readPayload(data) {
  if (!data) return {};
  try {
    return data.json() || {};
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return {};
    }
  }
}

/* Where a tap goes: always this site. An absolute link (built from NEXT_PUBLIC_SITE_URL) keeps its path even when
 * the app was opened from another of the site's addresses; anything unreadable opens /app. */
function targetUrl(u) {
  try {
    const url = new URL(typeof u === "string" && u ? u : "/app", self.location.origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return new URL("/app", self.location.origin).href;
    return new URL(url.pathname + url.search + url.hash, self.location.origin).href;
  } catch {
    return new URL("/app", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  const d = readPayload(event.data);
  const title = typeof d.title === "string" && d.title ? d.title : "Ctrl Room";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Every push must show a notification (browsers revoke push otherwise). When you're looking at the app it's
      // shown without a sound; the in-app chime already played.
      const looking = windows.some((w) => w.focused && w.visibilityState === "visible");
      await self.registration.showNotification(title, {
        body: typeof d.body === "string" ? d.body : "",
        tag: typeof d.tag === "string" && d.tag ? d.tag : undefined,
        renotify: Boolean(d.tag),
        icon: ICON,
        badge: BADGE,
        timestamp: typeof d.at === "number" ? d.at : Date.now(),
        silent: looking,
        data: { url: targetUrl(d.url) },
      });
      if (self.navigator && "setAppBadge" in self.navigator) {
        const shown = await self.registration.getNotifications();
        await self.navigator.setAppBadge(shown.length).catch(() => {});
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = targetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus().catch(() => {});
        // Let the app route it (keeps state, no reload); navigate() is the fallback for a window without the app.
        w.postMessage({ type: "ctrlroom:open", url: target });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
