"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/chat/Avatar";
import { ArrowLeftIcon, BellIcon } from "@/components/chat/icons";
import { LogoMark } from "@/components/Logo";
import { badgeLabel } from "@/lib/dms";
import { useOptionalShell } from "./ShellContext";

/**
 * The sticky bar at the top of each page in the shell: a title (or the mark, on Home), an optional back button, and
 * anything under it (the Feed's tabs). On phones it also carries your account (left) and Activity (right), since the
 * rail isn't there.
 */
export function PageHeader({
  title,
  sub,
  back,
  home = false,
  right,
  children,
  overlay,
}: {
  title: string;
  sub?: string;
  /** Show a back button; the fallback is where it goes when there's no history. */
  back?: string;
  home?: boolean;
  right?: React.ReactNode;
  children?: React.ReactNode;
  /** Floats just under the bar (the Feed's "Show new posts"). */
  overlay?: React.ReactNode;
}) {
  const shell = useOptionalShell();
  const router = useRouter();
  const activity = shell?.badges.activity ?? 0;
  return (
    <div className="cr-safe-top sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="relative flex h-[53px] items-center gap-3 px-4">
        {/* On phones the home logo is centred to the screen, not to the space left between the avatar and the icons
            (which are uneven), so it never drifts off-centre. */}
        {home && <LogoMark aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 md:hidden" />}
        {shell && !back && (
          <button type="button" className="-ml-1 rounded-full md:hidden" onClick={() => shell.open("account")} aria-label="Your account">
            <Avatar profile={shell.me} size={32} />
          </button>
        )}
        {back && (
          <button
            type="button"
            className="-ml-2 rounded-full p-2 hover:bg-raised"
            aria-label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${home ? "max-md:text-center" : ""}`}>
          <h1 className={`truncate text-xl font-bold leading-tight tracking-tight ${home ? "max-md:sr-only" : ""}`}>{title}</h1>
          {sub && <p className="truncate text-[13px] leading-tight text-muted">{sub}</p>}
        </div>
        {right}
        {shell && (
          <Link
            href="/app/feed/activity"
            className="relative -mr-1 rounded-full p-2 hover:bg-raised md:hidden"
            aria-label={activity > 0 ? `Activity, ${badgeLabel(activity)} new` : "Activity"}
          >
            <BellIcon className="h-[22px] w-[22px]" />
            {activity > 0 && (
              <span aria-hidden="true" data-n={badgeLabel(activity)} className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-4 text-signal-fg ring-2 ring-bg after:content-[attr(data-n)]" />
            )}
          </Link>
        )}
      </div>
      {children}
      {overlay && <div className="pointer-events-none absolute inset-x-0 top-full flex justify-center pt-3">{overlay}</div>}
    </div>
  );
}
