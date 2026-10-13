import Link from "next/link";
import s from "./landing.module.css";

/** A cut-corner frame with a chrome edge (top-left and bottom-right chamfers, like the mark's bracket). */
export function Cut({
  children,
  cut = 20,
  className = "",
  inner = "",
  hover = false,
  quiet = false,
}: {
  children: React.ReactNode;
  cut?: number;
  className?: string;
  inner?: string;
  hover?: boolean;
  quiet?: boolean;
}) {
  return (
    <div className={`${s.cut} ${hover ? s.cutHover : ""} ${className}`} style={{ "--c": `${cut}px` } as React.CSSProperties}>
      <div className={`${s.cutIn} ${quiet ? s.quiet : ""} ${inner}`}>{children}</div>
    </div>
  );
}

/** The hex bracket from the mark, as a small glyph. */
export function Bracket({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 14" className={`${s.bracket} ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 1 L1.5 4.6 L1.5 9.4 L8 13" />
    </svg>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-muted ${className}`}>
      <Bracket className="text-fg" />
      {children}
    </p>
  );
}

export function CtaLink({
  href,
  children,
  variant = "primary",
  small = false,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "glass";
  small?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={`${s.btn} ${variant === "primary" ? s.btnPrimary : s.btnGlass} ${small ? s.btnSm : ""} ${className}`}>
      <span>{children}</span>
    </Link>
  );
}

export const H2 = "text-balance text-[clamp(2rem,4.6vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.035em]";
export const LEAD = "text-pretty text-[17px] leading-relaxed text-muted sm:text-lg";
