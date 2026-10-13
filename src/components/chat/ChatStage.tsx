"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { navSwipeTarget } from "@/lib/swipe";
import { useCommunity, useNavOpen } from "./CommunityContext";

/** Phones only (matches Tailwind's md breakpoint). */
const PHONE = "(max-width: 767px)";
const SLOP = 10;
/** The settle transition in globals.css (.cr-stage), plus a frame. */
const SETTLE_MS = 400;

/** [data-moving] on the row while the chat moves or settles: the rooms under it stay painted (globals.css). */
const moving = (() => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return {
    start(row: HTMLElement) {
      clearTimeout(t);
      row.setAttribute("data-moving", "");
    },
    settle(row: HTMLElement) {
      clearTimeout(t);
      t = setTimeout(() => row.removeAttribute("data-moving"), SETTLE_MS);
    },
  };
})();

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * Where a drag must stay with what's under the finger: fields, sliders, sideways scrollers, things that drag
 * themselves, and anything that sits over the chat (side panels, dialogs, the image viewer) — those have their own
 * swipes.
 */
function keepsTheGesture(target: EventTarget | null, open: boolean): boolean {
  let el = target instanceof Element ? target : null;
  if (el?.closest("dialog, [role=dialog], .cr-panel, [data-no-swipe], input[type=range]")) return true;
  if (el?.closest("input, textarea, select, [contenteditable=true]")) return true;
  if (open) return false;
  for (; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if ((s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/** A room or a conversation is on screen (not the community's own index). */
function inChat(path: string): boolean {
  return /^\/c\/[^/]+\/(?!settings(?:\/|$))[^/]+/.test(path);
}

/**
 * The row under the community header: the sidebar and the chat. On desktop and tablets it's a plain flex row. On
 * phones it's a full-screen navigation panel (community rail + rooms) with the chat on top of it, like a native chat
 * app: swipe right on the chat (anywhere, as long as it's a sideways drag) to slide it away and show the rooms, swipe
 * left or tap the strip that's left to slide it back. It follows the finger 1:1 and settles by distance and speed
 * (src/lib/swipe.ts); reduced motion makes it instant. The back gesture / button goes back to the rooms too.
 *
 * Speed: the drag never touches React (refs and one transform write per pointermove; the chat is its own compositor
 * layer on phones), and the open/closed state is its own context (useNavOpen), so settling re-renders this component,
 * not the room. The rooms underneath are visibility: hidden while covered (globals.css, [data-moving] while anything
 * moves) rather than inert, which would restyle the whole list on every open and close.
 */
export function ChatStage({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { setNavOpen } = useCommunity();
  const navOpen = useNavOpen();
  const phone = usePhone();
  const pathname = usePathname();
  const row = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const open = useRef(navOpen);
  open.current = navOpen;

  // ── gesture
  useEffect(() => {
    const el = row.current;
    const st = stage.current;
    if (!el || !st || !phone) return;
    // Lay the rooms out once with the page (content-visibility keeps that while they're covered), so the first
    // swipe doesn't have to build them.
    moving.start(el);
    moving.settle(el);
    let state: "idle" | "pending" | "dragging" | "ignored" = "idle";
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let from = 0; // where the stage started, px
    let x = 0;
    let span = 0;
    let samples: { t: number; x: number }[] = [];

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || state === "dragging") return;
      // Closed: only the chat starts it. Open: the rooms or the strip.
      if (!open.current && !st.contains(e.target as Node)) return;
      if (keepsTheGesture(e.target, open.current)) return;
      state = "pending";
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      span = el.clientWidth - (parseFloat(getComputedStyle(el).getPropertyValue("--cr-peek-px")) || 52);
      from = open.current ? span : 0;
      x = from;
      samples = [{ t: e.timeStamp, x }];
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id || (state !== "pending" && state !== "dragging")) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (state === "pending") {
        // Looks like a sideways drag: start painting the rooms now, a frame or two before the chat moves (showing
        // them restyles the list, and that shouldn't land on the first frame of the slide).
        if (!open.current && dx > 3 && dx > Math.abs(dy)) moving.start(el);
        if (Math.hypot(dx, dy) < SLOP) return;
        // Vertical scrolling never turns into this; nor does a drag the wrong way.
        if (Math.abs(dy) > Math.abs(dx) * 0.8 || (!open.current && dx < 0) || (open.current && dx > 0)) {
          state = "ignored";
          moving.settle(el);
          return;
        }
        state = "dragging";
        moving.start(el);
        st.setAttribute("data-dragging", "");
        try {
          el.setPointerCapture(id);
        } catch {
          // released already
        }
      }
      x = Math.min(span, Math.max(0, from + dx));
      st.style.transform = `translate3d(${x}px, 0, 0)`;
      samples.push({ t: e.timeStamp, x });
      if (samples.length > 6) samples.shift();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const was = state;
      state = "idle";
      id = -1;
      moving.settle(el);
      if (was !== "dragging") return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
      const target = e.type === "pointercancel" ? open.current : navSwipeTarget({ open: open.current, x, span, velocity: v });
      // Settle from where the finger left it: the class flips in this same frame as the inline transform goes, so the
      // CSS transition runs from x to the target (React catches up with the same value).
      el.setAttribute("data-nav", target ? "open" : "closed");
      st.removeAttribute("data-dragging");
      st.style.transform = "";
      if (target !== open.current) setNavOpen(target);
    };
    // While dragging, keep the page itself from scrolling or bouncing.
    const touchmove = (e: TouchEvent) => {
      if (state === "dragging" && e.cancelable) e.preventDefault();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("touchmove", touchmove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("touchmove", touchmove);
    };
  }, [phone, setNavOpen]);

  // ── back gesture / back button: in a room on a phone there's one history entry for "the chat"; going back from it
  // shows the rooms instead of leaving. Next keeps its own router state in the entry (it patches pushState). Going
  // back to the rooms waits for the slide to finish: the router re-renders on popstate, and that must not land on
  // the animation's first frames.
  useEffect(() => {
    if (!phone || !inChat(pathname)) return;
    const marked = () => (window.history.state as { crChat?: boolean } | null)?.crChat === true;
    if (!navOpen && !marked()) window.history.pushState({ ...(window.history.state ?? {}), crChat: true }, "", window.location.href);
    if (navOpen && marked()) {
      const t = setTimeout(() => {
        if (open.current && marked()) window.history.back();
      }, SETTLE_MS);
      return () => clearTimeout(t);
    }
  }, [phone, pathname, navOpen]);
  useEffect(() => {
    if (!phone) return;
    const onPop = () => {
      if (inChat(window.location.pathname) && !(window.history.state as { crChat?: boolean } | null)?.crChat) setNavOpen(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [phone, setNavOpen]);

  // Any change of state slides: keep the rooms painted until it's done.
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!row.current) return;
    moving.start(row.current);
    moving.settle(row.current);
  }, [navOpen]);

  // The chat under the strip is inert while the rooms show (keyboard and screen readers stay in the rooms). Flipping
  // inert restyles the whole room, so never in the frame a slide starts: it goes inert once the slide has finished,
  // and comes back one frame into the slide back. Until then the strip covers it anyway.
  const [chatInert, setChatInert] = useState(navOpen);
  useEffect(() => {
    let raf = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (navOpen) t = setTimeout(() => setChatInert(true), SETTLE_MS);
    else raf = requestAnimationFrame(() => (t = setTimeout(() => setChatInert(false), 0)));
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [navOpen]);

  const covered = phone && navOpen;
  return (
    <div ref={row} className="cr-stage-row flex min-h-0 flex-1 overflow-hidden" data-nav={navOpen ? "open" : "closed"}>
      <div className="cr-nav">
        {sidebar}
      </div>
      <main ref={stage} className="cr-stage flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1" inert={phone && chatInert}>
          {children}
        </div>
        {covered && <button className="cr-peek" onClick={() => setNavOpen(false)} aria-label="Back to the chat" />}
      </main>
    </div>
  );
}
