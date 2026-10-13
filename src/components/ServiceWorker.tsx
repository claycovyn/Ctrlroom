"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { swUrl } from "@/lib/swUrl";

// Set when you tap Reload. The first install also changes the controller (clients.claim), and that must not reload.
let reloadRequested = false;

/**
 * Registers public/sw.js in production (after the page has loaded, so it never competes with it), offers a reload
 * when a new version is ready, and routes notification taps inside the app. Mounted once in the root layout.
 */
export function ServiceWorker() {
  const router = useRouter();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    // A tap on a notification while the app is open (public/sw.js notificationclick).
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "ctrlroom:open" || typeof d.url !== "string") return;
      const u = new URL(d.url, location.origin);
      if (u.origin !== location.origin) return;
      // Direct messages open inside the community you're in, when you're in one.
      const here = /^\/c\/([^/]+)/.exec(location.pathname);
      const path = here && u.pathname.startsWith("/app/dm/") ? `/c/${here[1]}/dm/${u.pathname.slice(8)}` : u.pathname;
      router.push(path + u.search + u.hash);
    };
    sw.addEventListener("message", onMessage);

    // Opening the app clears the Home Screen badge the worker set.
    const clearBadge = () => {
      if (document.visibilityState !== "visible") return;
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
      nav.clearAppBadge?.().catch(() => {});
    };
    clearBadge();
    document.addEventListener("visibilitychange", clearBadge);

    let cancelled = false;
    if (process.env.NODE_ENV === "production") {
      const watch = (reg: ServiceWorkerRegistration) => {
        const offer = (w: ServiceWorker | null) => {
          // Only an update: the first install has nothing to replace.
          if (w && sw.controller && !cancelled) setWaiting(w);
        };
        offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed") offer(next);
          });
        });
      };
      const register = () => {
        sw.register(swUrl(), { scope: "/", updateViaCache: "none" })
          .then(watch)
          .catch(() => {});
      };
      if (document.readyState === "complete") setTimeout(register, 1000);
      else window.addEventListener("load", () => setTimeout(register, 1000), { once: true });
    }

    const onController = () => {
      if (!reloadRequested) return;
      reloadRequested = false;
      location.reload();
    };
    sw.addEventListener("controllerchange", onController);

    return () => {
      cancelled = true;
      sw.removeEventListener("message", onMessage);
      sw.removeEventListener("controllerchange", onController);
      document.removeEventListener("visibilitychange", clearBadge);
    };
  }, [router]);

  if (!waiting) return null;
  return (
    <div role="status" className="cr-toast">
      <span className="min-w-0 flex-1">New version ready</span>
      <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => {
          reloadRequested = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}>
        Reload
      </button>
      <button className="btn-ghost px-2 py-1.5 text-xs text-muted" onClick={() => setWaiting(null)} aria-label="Later">
        Later
      </button>
    </div>
  );
}
