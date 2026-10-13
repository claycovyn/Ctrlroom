"use client";

import type { useRouter } from "next/navigation";
import { lastPlaceCookie, validPlace } from "@/lib/lastPlace";

type Router = ReturnType<typeof useRouter>;

const prefetched = new Set<string>();

/**
 * Loads a room's page data before the tap lands (on hover, or the touchstart that precedes a tap), so switching rooms
 * doesn't wait on the server. Once per page view per room.
 */
export function prefetchRoute(router: Router, href: string): void {
  if (prefetched.has(href)) return;
  prefetched.add(href);
  // "full" = the page's own data too, not only its loading shell (PrefetchKind.FULL; the enum isn't exported).
  router.prefetch(href, { kind: "full" } as unknown as Parameters<Router["prefetch"]>[1]);
}

/** RoomView fires this when a room is on screen (the end of a room-switch transition). */
export const ROOM_SHOWN = "ctrlroom:room-shown";

/**
 * Room switching with the View Transitions API where there is one: the old room crossfades into the new one. Waits at
 * most 300 ms for the new room (a prefetched room is there at once); otherwise RoomView's CSS fade (.cr-room-in) runs
 * when it arrives. Plain clicks only; new-tab clicks and reduced motion are left alone.
 */
export function navigateWithTransition(e: React.MouseEvent<HTMLAnchorElement>, router: Router, href: string): void {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };
  if (!doc.startViewTransition || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Phones: the chat slides back over the rooms instead. A view transition would freeze the screen (a snapshot) while
  // the room loads and then crossfade before that slide could start.
  if (window.matchMedia("(max-width: 767px)").matches) return;
  if (location.pathname === href) return;
  e.preventDefault();
  const root = document.documentElement;
  root.classList.add("cr-vt");
  const t = doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener(ROOM_SHOWN, finish);
          resolve();
        };
        window.addEventListener(ROOM_SHOWN, finish);
        setTimeout(finish, 300);
        router.push(href);
      }),
  );
  t.finished.finally(() => root.classList.remove("cr-vt"));
}

/** Asks the room on screen to open one of its panels (the phone navigation's search field sends "search"). */
export const OPEN_PANEL = "ctrlroom:open-panel";

/** Remembers the last room per community, so a phone opens there (the community index and the app's launch). */
export function rememberRoom(communitySlug: string, roomSlug: string): void {
  try {
    localStorage.setItem(`ctrlroom:last-room:${communitySlug}`, roomSlug);
    localStorage.setItem("ctrlroom:last-place", `/c/${communitySlug}/${roomSlug}`);
  } catch {
    // storage blocked
  }
  // The server reads this on a Home Screen launch (src/app/app/page.tsx) and goes straight to the room.
  try {
    const place = validPlace(`/c/${communitySlug}/${roomSlug}`);
    if (place) document.cookie = lastPlaceCookie(place, location.protocol === "https:");
  } catch {
    // cookies blocked
  }
}

export function lastRoom(communitySlug: string): string | null {
  try {
    return localStorage.getItem(`ctrlroom:last-room:${communitySlug}`);
  } catch {
    return null;
  }
}

export function lastPlace(): string | null {
  try {
    return validPlace(localStorage.getItem("ctrlroom:last-place"));
  } catch {
    return null;
  }
}
