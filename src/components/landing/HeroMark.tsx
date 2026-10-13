"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from "react";
import s from "./landing.module.css";

// The left half of a pointy-top hexagon: the bracket from the Ctrl Room mark.
const BRACKET = "M60 4 L8 34 L8 126 L60 156";

function Planes({ size, depth, sdepth, opacity, gap }: { size: number; depth: number; sdepth: number; opacity: number; gap: number }) {
  return (
    <div
      className={s.layer}
      style={{ "--depth": depth, "--sdepth": sdepth, width: size * 2 + gap, opacity } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${size * 2 + gap} ${size * 2.4}`} className="h-auto w-full overflow-visible" fill="none">
        <defs>
          <linearGradient id={`hb-${size}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <g transform={`scale(${size / 64} ${(size * 2.4) / 160})`} stroke={`url(#hb-${size})`} strokeWidth={(1.4 * 64) / size}>
          <path d={BRACKET} />
        </g>
        <g
          transform={`translate(${size * 2 + gap} 0) scale(${-size / 64} ${(size * 2.4) / 160})`}
          stroke={`url(#hb-${size})`}
          strokeWidth={(1.4 * 64) / size}
        >
          <path d={BRACKET} />
        </g>
      </svg>
    </div>
  );
}

/** The real mark, framed by layered bracket planes that drift with the pointer and the scroll. */
export function HeroMark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let mx = 0;
    let my = 0;
    const paint = () => {
      raf = 0;
      el.style.setProperty("--mx", mx.toFixed(3));
      el.style.setProperty("--my", my.toFixed(3));
      el.style.setProperty("--sy", Math.min(window.scrollY, 600).toFixed(0));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
      queue();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", queue, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", queue);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={`${s.markStage} text-fg`}>
      <Planes size={150} gap={150} depth={-10} sdepth={0.12} opacity={0.12} />
      <Planes size={110} gap={110} depth={-22} sdepth={0.06} opacity={0.22} />
      <Planes size={78} gap={70} depth={-34} sdepth={0.02} opacity={0.4} />
      <div className={s.layer} style={{ "--depth": 14, "--sdepth": -0.04 } as React.CSSProperties}>
        <div className="relative">
          <img src="/brand/ctrlroom-mark-on-light.png" alt="" width={270} height={260} className={`${s.markImg} dark:hidden`} />
          <img src="/brand/ctrlroom-mark-on-dark.png" alt="" width={270} height={260} className={`${s.markImg} hidden dark:block`} />
          <span
            className={`${s.sheen} dark:hidden`}
            style={{ "--mask": "url(/brand/ctrlroom-mark-on-light.png)" } as React.CSSProperties}
            aria-hidden="true"
          />
          <span
            className={`${s.sheen} hidden dark:block`}
            style={{ "--mask": "url(/brand/ctrlroom-mark-on-dark.png)" } as React.CSSProperties}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
