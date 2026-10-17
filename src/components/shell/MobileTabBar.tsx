"use client";

// The one bottom bar for phones, the same on the feed, in communities and in direct messages, so moving between the
// social side and the community side never swaps the navigation (operator, 2026-10-17: "like Slack, smooth"). It only
// steps aside while a conversation's composer is up (the shells pass `show={false}` there). Outside the social shell
// (communities, DMs) it loads its own unread counts with useTabBadges.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChatsIcon, HexIcon, HomeIcon, PlusIcon, UserIcon } from "@/components/chat/icons";
import { badgeCount, badgeLabel, type DmConversation } from "@/lib/dms";
import { useBroadcast } from "@/lib/realtime";
import { DM_READ_EVENT, SEEN_EVENT } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";

type Me = { id: string; username: string };

/** Which tab is active, including the community and DM routes the social shell's navKeyFor doesn't cover. */
function activeTab(pathname: string, search: string, username: string): string | null {
  if (pathname.startsWith("/c/") && /\/dm(\/|$)/.test(pathname)) return "messages";
  if (pathname.startsWith("/c/")) return "communities";
  if (pathname.startsWith("/app/dm")) return "messages";
  if (pathname.startsWith("/app/communities")) return "communities";
  if (pathname === `/u/${username}` || pathname.startsWith(`/u/${username}/`)) return "profile";
  if (pathname.startsWith("/app/settings")) return "profile";
  if (pathname === "/app" || pathname === "/app/feed" || pathname.startsWith("/app/feed/")) return "home";
  return null;
}

/** Unread DM and activity counts, for the bar in the community and DM shells (the social shell passes its own). */
export function useTabBadges(me: Me): { dms: number; activity: number } {
  const [dms, setDms] = useState(0);
  const [activity, setActivity] = useState(0);
  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: inbox }, { data: unseen }] = await Promise.all([sb.rpc("my_dm_inbox"), sb.rpc("my_activity_unseen")]);
    setDms(badgeCount((inbox ?? []) as DmConversation[]));
    setActivity(Number(unseen ?? 0));
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    const seen = () => setActivity(0);
    window.addEventListener(DM_READ_EVENT, refresh);
    window.addEventListener(SEEN_EVENT, seen);
    return () => {
      window.removeEventListener(DM_READ_EVENT, refresh);
      window.removeEventListener(SEEN_EVENT, seen);
    };
  }, [load]);
  const bump = () => setActivity((n) => n + 1);
  useBroadcast(`user:${me.id}`, { follow: bump, follow_approved: bump, post_like: bump, post_reply: bump, mention: bump, dm: () => void load(), dm_conversation: () => void load() });
  return { dms, activity };
}

/**
 * The bar. `onCompose` runs the new-post action (the social shell opens its sheet; elsewhere it routes home to it).
 * `show` hides it while a conversation composer owns the bottom of the screen.
 */
export function MobileTabBar({ me, dms, activity, onCompose, show = true }: { me: Me; dms: number; activity: number; onCompose: () => void; show?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = activeTab(pathname, search?.toString() ?? "", me.username);
  if (!show) return null;
  const items = [
    { key: "home", label: "Home", href: "/app", icon: HomeIcon, n: 0 },
    { key: "communities", label: "Communities", href: "/app/communities", icon: HexIcon, n: 0 },
    null,
    { key: "messages", label: "Messages", href: "/app/dm", icon: ChatsIcon, n: dms },
    { key: "profile", label: "Profile", href: `/u/${me.username}`, icon: UserIcon, n: activity },
  ] as const;
  return (
    <nav aria-label="Main" className="cr-tabbar cr-chrome fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg/95 backdrop-blur md:hidden">
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around">
        {items.map((n) =>
          n ? (
            <li key={n.key} className="flex flex-1">
              <Link
                href={n.href}
                aria-current={current === n.key ? "page" : undefined}
                aria-label={n.n > 0 ? `${n.label}, ${badgeLabel(n.n)} new` : n.label}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${current === n.key ? "text-fg" : "text-muted"}`}
              >
                <span className="relative">
                  <n.icon className="h-6 w-6" />
                  {n.n > 0 && (
                    <span aria-hidden="true" data-n={badgeLabel(n.n)} className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg after:content-[attr(data-n)]" />
                  )}
                </span>
                {n.label}
              </Link>
            </li>
          ) : (
            <li key="post" className="flex flex-1 items-center justify-center">
              <button type="button" onClick={onCompose} className="btn-primary h-11 w-14 rounded-full px-0" aria-label="New post">
                <PlusIcon className="h-6 w-6" />
              </button>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
