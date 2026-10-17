"use client";

// The one navigation spine, the same on the feed, in direct messages and in every community (operator, 2026-10-17:
// one cohesive app, Discord/Slack-style). Home (the feed), DMs, Activity, then your communities, a create button, and
// your account — a narrow rail that stays put while the content swaps. Real data; shared by the social shell and the
// community shell so they're identical.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CommunityIcon } from "@/components/CommunityMedia";
import { Avatar } from "@/components/chat/Avatar";
import { BellIcon, ChatsIcon, HomeIcon, PlusIcon } from "@/components/chat/icons";
import { LogoMark } from "@/components/Logo";
import { badgeLabel } from "@/lib/dms";
import type { ShellCommunity, ShellMe } from "@/lib/shell";

/** A rail item (icon or community avatar) with the active pill and an optional unread badge. */
function Item({ href, label, active, badge, onClick, children }: { href?: string; label: string; active?: boolean; badge?: number; onClick?: () => void; children: React.ReactNode }) {
  const inner = (
    <>
      <span aria-hidden className={`absolute left-0 w-1 rounded-r-full bg-fg transition-all ${active ? "h-7" : "h-0"}`} />
      <span className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl transition-all ${active ? "rounded-xl bg-signal text-signal-fg" : "bg-raised text-fg hover:rounded-xl hover:bg-line"}`}>{children}</span>
      {badge != null && badge > 0 && <span aria-hidden="true" data-n={badgeLabel(badge)} className="absolute -right-0 -top-0 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg after:content-[attr(data-n)]" />}
    </>
  );
  const cls = "group relative flex h-12 w-12 items-center justify-center";
  return href ? (
    <Link href={href} aria-label={badge && badge > 0 ? `${label}, ${badgeLabel(badge)} new` : label} aria-current={active ? "page" : undefined} className={cls} title={label}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={cls} title={label}>
      {inner}
    </button>
  );
}

export function Spine({ me, communities, dms, activity, activeCommunity, onAccount, className = "sticky top-0 h-dvh" }: { me: ShellMe; communities: ShellCommunity[]; dms: number; activity: number; activeCommunity?: string | null; onAccount?: () => void; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const onFeed = (pathname === "/app" || pathname === "/app/feed" || (pathname.startsWith("/app/feed/") && !pathname.startsWith("/app/feed/activity"))) && !activeCommunity;
  const onDm = pathname.startsWith("/app/dm") && !activeCommunity;
  const onActivity = pathname.startsWith("/app/feed/activity");
  void search;
  return (
    <nav aria-label="Spine" className={`flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg py-3 ${className}`}>
      <Link href="/app" className="mb-1 flex h-11 w-11 items-center justify-center" aria-label="Ctrl Room">
        <LogoMark className="h-9 w-9" />
      </Link>
      <Item href="/app" label="Home" active={onFeed}>
        <HomeIcon className="h-5 w-5" />
      </Item>
      <Item href="/app/dm" label="Direct messages" active={onDm} badge={dms}>
        <ChatsIcon className="h-5 w-5" />
      </Item>
      <Item href="/app/feed/activity" label="Activity" active={onActivity} badge={activity}>
        <BellIcon className="h-5 w-5" />
      </Item>
      <span aria-hidden className="my-1 h-px w-7 shrink-0 bg-line" />
      <div className="scroll-thin flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {communities.map((c) => (
          <Item key={c.id} href={`/c/${c.slug}`} label={c.name} active={activeCommunity === c.slug}>
            <CommunityIcon community={c} className="h-11 w-11 rounded-[inherit] text-lg" />
          </Item>
        ))}
        <Item href="/app/communities" label="Find or create a community">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-line text-muted group-hover:rounded-xl group-hover:border-fg/40 group-hover:text-fg">
            <PlusIcon className="h-5 w-5" />
          </span>
        </Item>
      </div>
      <button type="button" onClick={onAccount} className="mt-1 shrink-0 rounded-full" aria-label={`Account, ${me.display_name}`}>
        <Avatar profile={me} size={38} />
      </button>
    </nav>
  );
}
