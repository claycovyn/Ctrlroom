"use client";

import { useEffect } from "react";

function editable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "range", "button", "submit", "file", "color"].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Small things that make the Home Screen app feel native on iPhone. Mounted once in the root layout; renders
 * nothing.
 *   - --cr-vh: the height you can actually see. Safari on iOS doesn't shrink the page for the keyboard (it ignores
 *     interactive-widget), it scrolls the page under it. The app shell (.cr-shell) is sized to this instead, so the
 *     composer sits right on top of the keyboard and the header stays put. While pinch-zoomed it's left alone.
 *   - .cr-kb on <html> while the keyboard is up (no home-indicator padding then).
 *   - a passive touchstart listener, without which iOS never shows :active (pressed) styles.
 *   - data-standalone on <html> when opened from the Home Screen.
 */
export function NativeFeel() {
  useEffect(() => {
    const root = document.documentElement;
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches) root.dataset.standalone = "1";

    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });

    const vv = window.visualViewport;
    if (!vv) return () => document.removeEventListener("touchstart", noop);
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (vv.scale > 1.01) {
          root.style.removeProperty("--cr-vh");
          root.classList.remove("cr-kb");
          return;
        }
        const keyboard = window.innerHeight - vv.height > 120 && editable(document.activeElement);
        // Only shrink the shell to the visible height while the keyboard is up. Otherwise let the CSS fall back to
        // 100dvh: on iOS standalone (saved to the Home Screen) visualViewport.height can report short, which would
        // leave the app off the bottom of the screen (a white strip under the home indicator).
        if (keyboard) {
          root.style.setProperty("--cr-vh", `${Math.round(vv.height)}px`);
          root.style.setProperty("--cr-kb-h", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
        } else {
          root.style.removeProperty("--cr-vh");
          root.style.removeProperty("--cr-kb-h");
        }
        root.classList.toggle("cr-kb", keyboard);
        // The shell already fits above the keyboard; undo Safari's scroll of the whole page.
        if (keyboard && window.scrollY !== 0 && document.querySelector(".cr-shell")) window.scrollTo(0, 0);
      });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("touchstart", noop);
    };
  }, []);
  return null;
}
