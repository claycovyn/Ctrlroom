"use client";

import { useEffect, useRef } from "react";
import { swipeOutcome } from "@/lib/swipe";

export interface SwipeDismissOptions {
  /** The element that moves with your finger. */
  target: React.RefObject<HTMLElement | null>;
  /** Which way dismisses: "left" (drawer), "right" (side panel), "down" (bottom sheet). */
  direction: "left" | "right" | "down";
  enabled: boolean;
  onDismiss: () => void;
  /** Fades with the drag (the drawer's backdrop). */
  scrim?: React.RefObject<HTMLElement | null>;
  /**
   * Slide the element the rest of the way out before calling onDismiss (for things that unmount, like a sheet).
   * Without it, onDismiss runs at once and the element's own CSS transition carries it out (the drawer).
   */
  exitFirst?: boolean;
  /** Only below this viewport width (px), where the element covers the screen or sits at its edge. */
  maxWidth?: number;
}

const SLOP = 8;
const EXIT_MS = 260;

/**
 * Drag to dismiss on touch screens, like iOS sheets and drawers: the element follows your finger along one axis, then
 * either settles back or leaves, decided by how far and how fast you moved (src/lib/swipe.ts). Only touch and pen;
 * a mouse never drags. Sheets drag down from their grab handle only ([data-swipe-handle]).
 */
export function useSwipeDismiss({ target, direction, enabled, onDismiss, scrim, exitFirst = false, maxWidth = 767 }: SwipeDismissOptions) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;
    const horizontal = direction !== "down";
    const sign = direction === "left" ? -1 : 1;
    let state: "idle" | "pending" | "dragging" | "ignored" = "idle";
    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let offset = 0;
    let samples: { t: number; d: number }[] = [];

    const apply = (px: number) => {
      el.style.transform = horizontal ? `translateX(${sign * px}px)` : `translateY(${px}px)`;
      const size = horizontal ? el.offsetWidth : el.offsetHeight;
      if (scrim?.current) scrim.current.style.opacity = String(Math.max(0, 1 - px / Math.max(size, 1)));
    };
    const clear = () => {
      el.removeAttribute("data-dragging");
      scrim?.current?.removeAttribute("data-dragging");
      el.style.transform = "";
      if (scrim?.current) scrim.current.style.opacity = "";
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || state === "dragging" || window.innerWidth > maxWidth) return;
      // Not when you're starting on a control that drags itself (sliders, the cropper).
      if ((e.target as Element).closest("input[type=range], [data-no-swipe]")) return;
      // Down (sheets): only from the grab handle, since everything else in a sheet scrolls or takes taps.
      if (!horizontal && !(e.target as Element).closest("[data-swipe-handle]")) return;
      state = "pending";
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      offset = 0;
      samples = [{ t: e.timeStamp, d: 0 }];
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id || (state !== "pending" && state !== "dragging")) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      const along = horizontal ? dx * sign : dy;
      const across = horizontal ? dy : dx;
      if (state === "pending") {
        if (Math.hypot(dx, dy) < SLOP) return;
        if (along <= 0 || Math.abs(across) > Math.abs(along)) {
          state = "ignored";
          return;
        }
        state = "dragging";
        el.setAttribute("data-dragging", "");
        scrim?.current?.setAttribute("data-dragging", "");
        try {
          el.setPointerCapture(id);
        } catch {
          // already released
        }
      }
      offset = Math.max(0, along);
      samples.push({ t: e.timeStamp, d: offset });
      if (samples.length > 6) samples.shift();
      apply(offset);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const was = state;
      state = "idle";
      id = -1;
      if (was !== "dragging") return;
      const size = horizontal ? el.offsetWidth : el.offsetHeight;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity = last && first && last.t > first.t ? (last.d - first.d) / (last.t - first.t) : 0;
      if (e.type === "pointercancel" || swipeOutcome({ offset, size, velocity }) === "stay") {
        clear();
        return;
      }
      if (!exitFirst) {
        clear();
        dismiss.current();
        return;
      }
      el.removeAttribute("data-dragging");
      el.setAttribute("data-settling", "");
      el.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      el.style.transform = horizontal ? `translateX(${sign * 100}%)` : "translateY(100%)";
      if (scrim?.current) scrim.current.style.opacity = "0";
      window.setTimeout(() => {
        el.style.transition = "";
        el.removeAttribute("data-settling");
        dismiss.current();
      }, EXIT_MS);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      clear();
    };
  }, [target, scrim, direction, enabled, exitFirst, maxWidth]);
}
