"use client";

import { useEffect, useRef } from "react";
import s from "./landing.module.css";

/**
 * Fades its children up the first time they come into view. Elements already on screen when the page loads are
 * never hidden, so there's no flash, and without JavaScript or with reduced motion everything is simply visible.
 * It checks on scroll rather than with an IntersectionObserver so a jump (End key, anchor link) past an element
 * still shows it.
 */
export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const due = () => el.getBoundingClientRect().top < window.innerHeight * 0.92;
    if (due()) return;
    el.dataset.reveal = "armed";
    let raf = 0;
    const check = () => {
      raf = 0;
      if (!due()) return;
      el.dataset.reveal = "shown";
      stop();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return stop;
  }, []);
  return (
    <div ref={ref} className={`${s.reveal} ${className}`} style={{ "--d": `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}
