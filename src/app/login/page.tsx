export const dynamic = "force-dynamic";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CheckIcon } from "@/components/chat/icons";
import { Logo } from "@/components/Logo";
import { NotConfigured } from "@/components/NotConfigured";
import s from "@/components/landing/landing.module.css";
import { LINK_ERRORS } from "@/lib/authLinks";
import { isConfigured } from "@/lib/env";
import { openctrlEnabled } from "@/lib/openctrlLogin";
import { safeNext } from "@/lib/safeNext";
import { googleSigninEnabled, providerView } from "@/lib/signinProviders";
import { currentUser } from "@/lib/supabase/server";
import { AuthForm } from "./AuthForm";
import { ProviderButtons } from "./ProviderButtons";
import l from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Ctrl Room, or create an account: your communities, your people and the posts you follow, in one place.",
};

// Every line is something Ctrl Room does today (README.md).
const POINTS = ["Rooms, threads and voice for every community", "A feed of the people and communities you follow", "Free and open source, no feature paywalls"];

/** The hex bracket from the mark, in three sizes around it (like the landing page's hero, but still). */
const BRACKET = "M60 4 L8 34 L8 126 L60 156";
function Brackets() {
  return (
    <svg viewBox="0 0 480 300" className={l.brackets} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {[
        { k: 1, gap: 78, o: 0.45 },
        { k: 1.32, gap: 112, o: 0.26 },
        { k: 1.7, gap: 150, o: 0.14 },
      ].map(({ k, gap, o }) => (
        <g key={k} stroke="url(#lb)" strokeWidth="1.3" opacity={o}>
          <path d={BRACKET} vectorEffect="non-scaling-stroke" transform={`translate(${240 - gap - 60 * k} ${150 - 80 * k}) scale(${k})`} />
          <path d={BRACKET} vectorEffect="non-scaling-stroke" transform={`translate(${240 + gap + 60 * k} ${150 - 80 * k}) scale(${-k} ${k})`} />
        </g>
      ))}
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const mode = sp.mode === "signup" ? "signup" : "signin";
  const problem = sp.error ? LINK_ERRORS[sp.error] : undefined;
  if (!isConfigured()) return <NotConfigured />;
  const { user } = await currentUser();
  if (user) redirect(next);
  const q = next !== "/app" ? `&next=${encodeURIComponent(next)}` : "";
  const invite = next.startsWith("/invite/");

  return (
    <div className={`${s.page} ${l.split} min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]`}>
      {/* The brand side: the mark, large, and what Ctrl Room is. */}
      <section className={`${l.brand} relative overflow-hidden lg:min-h-dvh lg:border-r lg:border-line`} aria-labelledby="login-headline">
        <div className={s.backdrop} aria-hidden="true" />
        <div className={s.glow} aria-hidden="true" />
        <div className="relative mx-auto flex h-full max-w-xl flex-col px-6 pb-8 pt-[max(1.5rem,var(--cr-safe-top))] sm:px-10 lg:justify-center lg:py-16">
          <Link href="/" className="w-fit rounded-sm lg:absolute lg:left-10 lg:top-8">
            <Logo className="h-7 w-auto" />
          </Link>
          <div className={`${l.markStage} text-fg`}>
            <Brackets />
            <img src="/brand/ctrlroom-mark-on-light.png" alt="" width={270} height={260} className={`${l.mark} dark:hidden`} />
            <img src="/brand/ctrlroom-mark-on-dark.png" alt="" width={270} height={260} className={`${l.mark} hidden dark:block`} />
          </div>
          <h1 id="login-headline" className={`${s.chrome} text-balance text-[clamp(2.1rem,5.2vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]`}>
            <span className="lg:block">Your communities.</span> <span className="lg:block">Your people.</span>{" "}
            <span className="lg:block">All in one room.</span>
          </h1>
          <ul className="mt-6 hidden space-y-2.5 sm:block">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px] text-muted">
                <CheckIcon className="h-4 w-4 shrink-0 text-fg" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The sign-in side: OpenCtrl, then Google, then email (src/lib/signinProviders.ts). */}
      <main className="flex items-start justify-center px-4 pb-12 pt-2 sm:px-6 lg:min-h-dvh lg:items-center lg:py-12">
        <div className="w-full max-w-[25rem]">
          <h2 className="text-[28px] font-bold leading-tight tracking-tight">{mode === "signup" ? "Join today." : "Welcome back."}</h2>
          <p className="mt-2 text-[15px] text-muted">
            {invite ? (mode === "signup" ? "Create an account to accept your invite." : "Sign in to accept your invite.") : "One account for every community you join."}
          </p>
          <nav aria-label="Sign in or create an account" className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-panel p-1 text-sm font-medium">
            <Link
              href={`/login?mode=signin${q}`}
              aria-current={mode === "signin" ? "page" : undefined}
              className={`rounded-md py-2 text-center transition-colors ${mode === "signin" ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              Sign in
            </Link>
            <Link
              href={`/login?mode=signup${q}`}
              aria-current={mode === "signup" ? "page" : undefined}
              className={`rounded-md py-2 text-center transition-colors ${mode === "signup" ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              Create account
            </Link>
          </nav>
          <div className="mt-6">
            {problem && (
              <p role="alert" className="mb-4 text-sm text-alert">
                {problem}
              </p>
            )}
            <ProviderButtons
              view={providerView({ openctrl: openctrlEnabled(), google: googleSigninEnabled() }, { openctrl: sp.openctrl, google: sp.google })}
              next={next}
            />
            <AuthForm mode={mode} next={next} />
          </div>
          <p className="mt-10 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <Link href="/" className="hover:text-fg">
              About Ctrl Room
            </Link>
            <Link href="/docs" className="hover:text-fg">
              Docs
            </Link>
            <a href="/source" className="hover:text-fg">
              Source code
            </a>
            <span>An OpenCtrl original</span>
          </p>
        </div>
      </main>
    </div>
  );
}
