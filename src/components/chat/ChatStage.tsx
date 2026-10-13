"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { swipeOutcome } from "@/lib/swipe";
import { useCommunity } from "./CommunityContext";

/** Phones only (matches Tailwind's md breakpoint). */
const PHONE = "(max-width: 767px)";
const SLOP = 10;

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

/** Where a drag inside the chat must stay native: fields, sliders, sideways scrollers, things that drag themselves. */
function keepsTheGesture(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  if (el?.closest("input, textarea, select, [contenteditable=true], [data-no-swipe], input[type=range]")) return true;
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
 */
export function ChatStage({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { navOpen, setNavOpen } = useCommunity();
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
    let state: "idle" | "pending" | "dragging" | "ignored" = "idle";
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let from = 0; // where the stage started, px
    let x = 0;
    let samples: { t: number; x: number }[] = [];
    const span = () => el.clientWidth - parseFloat(getComputedStyle(el).getPropertyValue("--cr-peek-px") || "52");

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || state === "dragging") return;
      // Closed: only the chat starts it. Open: the rooms or the strip.
      const onStage = st.contains(e.target as Node);
      if (!open.current && !onStage) return;
      if (!open.current && keepsTheGesture(e.target)) return;
      if (open.current && (e.target as Element).closest("input, textarea, select")) return;
      state = "pending";
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      from = open.current ? span() : 0;
      x = from;
      samples = [{ t: e.timeStamp, x }];
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id || (state !== "pending" && state !== "dragging")) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (state === "pending") {
        if (Math.hypot(dx, dy) < SLOP) return;
        // Vertical scrolling never turns into this; nor does a drag the wrong way.
        if (Math.abs(dy) > Math.abs(dx) * 0.8 || (!open.current && dx < 0) || (open.current && dx > 0)) {
          state = "ignored";
          return;
        }
        state = "dragging";
        st.setAttribute("data-dragging", "");
        try {
          el.setPointerCapture(id);
        } catch {
          // released already
        }
      }
      x = Math.min(span(), Math.max(0, from + dx));
      st.style.transform = `translateX(${x}px)`;
      samples.push({ t: e.timeStamp, x });
      if (samples.length > 6) samples.shift();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const was = state;
      state = "idle";
      id = -1;
      if (was !== "dragging") return;
      st.removeAttribute("data-dragging");
      st.style.transform = "";
      if (e.type === "pointercancel") return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
      const w = span();
      if (!open.current) {
        if (swipeOutcome({ offset: x, size: w, velocity: v }) === "dismiss") setNavOpen(true);
      } else if (swipeOutcome({ offset: w - x, size: w, velocity: -v }) === "dismiss") {
        setNavOpen(false);
      }
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
  // shows the rooms instead of leaving. Next keeps its own router state in the entry (it patches pushState).
  useEffect(() => {
    if (!phone || !inChat(pathname)) return;
    const marked = () => (window.history.state as { crChat?: boolean } | null)?.crChat === true;
    if (!navOpen && !marked()) window.history.pushState({ ...(window.history.state ?? {}), crChat: true }, "", window.location.href);
    if (navOpen && marked()) window.history.back();
  }, [phone, pathname, navOpen]);
  useEffect(() => {
    if (!phone) return;
    const onPop = () => {
      if (inChat(window.location.pathname) && !(window.history.state as { crChat?: boolean } | null)?.crChat) setNavOpen(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [phone, setNavOpen]);

  const covered = phone && navOpen;
  return (
    <div ref={row} className="cr-stage-row flex min-h-0 flex-1 overflow-hidden" data-nav={navOpen ? "open" : "closed"}>
      <div className="cr-nav" inert={phone && !navOpen}>
        {sidebar}
      </div>
      <main ref={stage} className="cr-stage flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1" inert={covered}>
          {children}
        </div>
        {covered && <button className="cr-peek" onClick={() => setNavOpen(false)} aria-label="Back to the chat" />}
      </main>
    </div>
  );
}
