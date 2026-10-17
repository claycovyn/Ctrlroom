"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { BellIcon, ChatsIcon, ChevronLeftIcon, ChevronRightIcon, CompassIcon, FeatherIcon, HexIcon, HomeIcon, MoreIcon, PlusIcon, SettingsIcon, UserIcon } from "@/components/chat/icons";
import { LogoMark } from "@/components/Logo";
import { badgeCount, badgeLabel, type DmConversation } from "@/lib/dms";
import { useBroadcast } from "@/lib/realtime";
import { activityOf, DM_READ_EVENT, navKeyFor, POST_EVENT, SEEN_EVENT, type CommunityActivity, type NavKey, type ShellCommunity, type ShellMe } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Unread } from "@/lib/types";
import { CommunitiesAside } from "./CommunitiesPanel";
import { Ctx, type ShellCtx, type ShellSheet } from "./ShellContext";
import s from "./shell.module.css";

// The sheets open on a tap: not part of the first load.
const Sheets = dynamic(() => import("./Sheets").then((m) => m.Sheets), { ssr: false });

/** How many communities get their unread counts fetched for the right column (one my_unreads call each). */
const ACTIVITY_MAX = 12;

/** After the page has painted and the browser is idle (or 1.5 s), so the feed comes first. */
function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(fn, 300);
  return () => clearTimeout(t);
}

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: (p: { className?: string }) => React.ReactNode;
}

/**
 * The signed-in shell: a rail on the left (Home, Explore, Communities, Messages, Activity, Profile, Settings, Post and
 * your account), the page in the middle, and your communities on the right from 1024px. Phones get a tab bar instead.
 * Mounted by the (shell) layout, so it stays put while you move between the Feed, profiles and Settings.
 */
export function AppShell({ me, communities, cloud, children }: { me: ShellMe; communities: ShellCommunity[]; cloud: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = navKeyFor(pathname, search?.toString() ?? "", me.username);
  const [sheet, setSheet] = useState<ShellSheet>(null);
  const [dms, setDms] = useState(0);
  const [social, setSocial] = useState(0);
  const [activity, setActivity] = useState<Record<string, CommunityActivity>>({});
  const [activityLoaded, setActivityLoaded] = useState(false);
  const onActivity = useRef(false);
  onActivity.current = current === "activity";

  // The rail can be collapsed to icons on wide screens (it's already icons below 1280px). The choice is remembered.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("cr_rail_collapsed") === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const toggleRail = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("cr_rail_collapsed", next ? "1" : "0");
      } catch {
        /* fine */
      }
      return next;
    });
  }, []);
  const expanded = !collapsed; // at xl; narrower screens are always icon-only

  const loadDms = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("my_dm_inbox");
    setDms(badgeCount((data ?? []) as DmConversation[]));
  }, []);

  // Badges and community activity load once the page is up; the shell stays mounted, so this runs once per visit.
  const ids = communities.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    const cancel = whenIdle(() => {
      const sb = supabaseBrowser();
      void loadDms();
      // On the Activity page itself everything is being marked seen.
      void sb.rpc("my_activity_unseen").then(({ data }) => live && setSocial(onActivity.current ? 0 : Number(data ?? 0)));
      const list = ids ? ids.split(",").slice(0, ACTIVITY_MAX) : [];
      void Promise.all(
        list.map(async (id) => {
          const { data } = await sb.rpc("my_unreads", { p_community: id });
          return [id, activityOf((data ?? []) as Unread[])] as const;
        }),
      ).then((rows) => {
        if (!live) return;
        setActivity(Object.fromEntries(rows));
        setActivityLoaded(true);
      });
    });
    return () => {
      live = false;
      cancel();
    };
  }, [ids, loadDms]);

  useEffect(() => {
    const seen = () => setSocial(0);
    window.addEventListener(SEEN_EVENT, seen);
    return () => window.removeEventListener(SEEN_EVENT, seen);
  }, []);

  // Reading a conversation clears it from the Messages badge right away.
  useEffect(() => {
    const read = () => void loadDms();
    window.addEventListener(DM_READ_EVENT, read);
    return () => window.removeEventListener(DM_READ_EVENT, read);
  }, [loadDms]);

  // The one listener on your own topic in the shell: activity counts, DMs, and new posts from private accounts you
  // follow (passed on to the Feed).
  const dmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refreshDms = () => {
    clearTimeout(dmTimer.current);
    dmTimer.current = setTimeout(() => void loadDms(), 400);
  };
  const bump = () => !onActivity.current && setSocial((n) => n + 1);
  useBroadcast(`user:${me.id}`, {
    follow: bump,
    follow_approved: bump,
    post_like: bump,
    post_reply: bump,
    post: (p: unknown) => window.dispatchEvent(new CustomEvent(POST_EVENT, { detail: p })),
    dm: refreshDms,
    dm_conversation: refreshDms,
    mention: (p: { community_id?: string }) => {
      if (!p?.community_id) return;
      setActivity((a) => {
        const cur = a[p.community_id!] ?? { rooms: 0, mentions: 0 };
        return { ...a, [p.community_id!]: { rooms: Math.max(cur.rooms, 1), mentions: cur.mentions + 1 } };
      });
    },
  });

  const open = useCallback((k: Exclude<ShellSheet, null>) => setSheet(k), []);
  const ctx = useMemo<ShellCtx>(
    () => ({ me, communities, activity, activityLoaded, badges: { dms, activity: social }, cloud, open }),
    [me, communities, activity, activityLoaded, dms, social, cloud, open],
  );

  const nav: NavItem[] = [
    { key: "home", label: "Home", href: "/app", icon: HomeIcon },
    { key: "explore", label: "Explore", href: "/app?tab=everyone", icon: CompassIcon },
    { key: "communities", label: "Communities", href: "/app/communities", icon: HexIcon },
    { key: "messages", label: "Messages", href: "/app/dm", icon: ChatsIcon },
    { key: "activity", label: "Activity", href: "/app/feed/activity", icon: BellIcon },
    { key: "profile", label: "Profile", href: `/u/${me.username}`, icon: UserIcon },
    { key: "settings", label: "Settings", href: "/app/settings", icon: SettingsIcon },
  ];
  const count = (k: NavKey) => (k === "messages" ? dms : k === "activity" ? social : 0);

  return (
    <Ctx.Provider value={ctx}>
      <div className={`${s.root} min-h-dvh bg-bg`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm">
          Skip to content
        </a>
        <div className="mx-auto flex max-w-[1265px] justify-center">
          {/* Rail: a floating glass panel. Icons from 768px, labels from 1280px (unless collapsed). */}
          <header className={`sticky top-2 z-20 mb-2 hidden h-[calc(100dvh-1rem)] w-[76px] shrink-0 flex-col items-center rounded-2xl bg-raised/30 px-2 py-3 shadow-lg ring-1 ring-line/70 backdrop-blur-xl transition-[width] duration-300 ease-out md:flex ${expanded ? "xl:w-[260px] xl:items-stretch xl:px-3" : ""}`}>
            <div className={`mb-3 flex w-full flex-col items-center gap-1 ${expanded ? "xl:flex-row xl:justify-between" : ""}`}>
              <Link href="/app" className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-raised xl:ml-1" aria-label="Ctrl Room home">
                <LogoMark className="h-9 w-9" />
              </Link>
              {/* Collapse or expand the rail (wide screens only; it's already icon-only below 1280px). */}
              <button
                type="button"
                onClick={toggleRail}
                aria-pressed={collapsed}
                aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
                title={collapsed ? "Expand" : "Collapse"}
                className="hidden h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg xl:flex"
              >
                {expanded ? <ChevronLeftIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
              </button>
            </div>
            <RailNav items={nav} current={current} count={count} expanded={expanded} />
            <button type="button" onClick={() => open("post")} className={`btn-primary mt-4 h-12 w-12 rounded-full px-0 text-[15px] font-semibold ${expanded ? "xl:h-[50px] xl:w-full" : ""}`} aria-label="New post">
              <FeatherIcon className={`h-5 w-5 ${expanded ? "xl:hidden" : ""}`} />
              {expanded && <span className="hidden xl:inline">Post</span>}
            </button>
            <div className="mt-auto w-full">
              <AccountButton me={me} expanded={expanded} />
            </div>
          </header>

          <main id="main" className={`${s.under} min-h-dvh w-full min-w-0 max-w-[600px] md:border-x md:border-line`} tabIndex={-1}>
            {children}
          </main>

          {/* Right column from 1024px. */}
          <aside className="sticky top-0 hidden h-dvh w-[316px] shrink-0 overflow-y-auto py-3 pl-6 scroll-thin lg:block xl:w-[350px]" aria-label="Your communities">
            <CommunitiesAside />
          </aside>
        </div>

        {/* Phones: a tab bar. */}
        <nav aria-label="Main" className={`${s.tabbar} cr-chrome fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden`}>
          <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around">
            {(
              [
                { key: "home", label: "Home", href: "/app", icon: HomeIcon },
                { key: "communities", label: "Communities", href: "/app/communities", icon: HexIcon },
                null,
                { key: "messages", label: "Messages", href: "/app/dm", icon: ChatsIcon },
                { key: "profile", label: "Profile", href: `/u/${me.username}`, icon: UserIcon },
              ] as (NavItem | null)[]
            ).map((n) =>
              n ? (
                <li key={n.key} className="flex flex-1">
                  <Link
                    href={n.href}
                    aria-current={current === n.key ? "page" : undefined}
                    aria-label={count(n.key) > 0 ? `${n.label}, ${badgeLabel(count(n.key))} new` : n.label}
                    className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${current === n.key ? "text-fg" : "text-muted"}`}
                  >
                    <span className="relative">
                      <n.icon className="h-6 w-6" />
                      {count(n.key) > 0 && (
                        <span aria-hidden="true" data-n={badgeLabel(count(n.key))} className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg after:content-[attr(data-n)]" />
                      )}
                    </span>
                    {n.label}
                  </Link>
                </li>
              ) : (
                <li key="post" className="flex flex-1 items-center justify-center">
                  <button type="button" onClick={() => open("post")} className="btn-primary h-11 w-14 rounded-full px-0" aria-label="New post">
                    <PlusIcon className="h-6 w-6" />
                  </button>
                </li>
              ),
            )}
          </ul>
        </nav>

        {sheet && <Sheets sheet={sheet} onClose={() => setSheet(null)} />}
      </div>
    </Ctx.Provider>
  );
}

/** Your account at the foot of the rail: name, @username, and a menu (profile, settings, desktop app, sign out). */
/**
 * The main nav, with an indicator that glides to the current page (the motion from the reference). Dependency-free:
 * one positioned element whose transform and size follow the active item, animated with a CSS transition; it honours
 * reduced motion. The items keep their routes, badges and keyboard behaviour.
 */
function RailNav({ items, current, count, expanded }: { items: NavItem[]; current: NavKey | null; count: (k: NavKey) => number; expanded: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  const refs = useRef(new Map<NavKey, HTMLAnchorElement>());
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // The pill tracks the item you point at or focus, and slides back to the current page when you leave (the reel's
  // behaviour). `active` is a dimmer marker that always sits on the current page, so you never lose where you are.
  const [hover, setHover] = useState<NavKey | null>(null);
  const target = hover ?? current;

  useEffect(() => {
    const measure = () => {
      const el = target ? refs.current.get(target) : null;
      if (!el) return setBox(null);
      setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Re-measure when the pointed/current item changes or the rail collapses/expands.
  }, [target, expanded]);

  const activeEl = current ? refs.current.get(current) : null;

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="relative flex flex-col items-center gap-0.5 xl:items-stretch"
      onMouseLeave={() => setHover(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null);
      }}
    >
      {/* A faint marker always on the current page (so hovering elsewhere doesn't lose your place). */}
      {current && activeEl && hover && hover !== current && (
        <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-xl ring-1 ring-line/50 motion-reduce:transition-none" style={{ transform: `translate(${activeEl.offsetLeft}px, ${activeEl.offsetTop}px)`, width: activeEl.offsetWidth, height: activeEl.offsetHeight }} />
      )}
      {box && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 rounded-xl bg-raised ring-1 ring-line/60 transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
        />
      )}
      {items.map((n) => {
        const on = current === n.key;
        const c = count(n.key);
        return (
          <Link
            key={n.key}
            ref={(el) => {
              if (el) refs.current.set(n.key, el);
              else refs.current.delete(n.key);
            }}
            href={n.href}
            onMouseEnter={() => setHover(n.key)}
            onFocus={() => setHover(n.key)}
            aria-current={on ? "page" : undefined}
            aria-label={c > 0 ? `${n.label}, ${badgeLabel(c)} new` : n.label}
            title={n.label}
            className={`relative z-10 flex h-12 items-center gap-4 rounded-xl px-3 text-[17px] transition-colors ${expanded ? "xl:pr-4" : ""} ${on || hover === n.key ? "font-semibold text-fg" : "text-fg/80"}`}
          >
            <span className="relative">
              <n.icon className="h-[22px] w-[22px]" />
              {c > 0 && (
                <span aria-hidden="true" data-n={badgeLabel(c)} className="absolute -right-2 -top-1.5 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg after:content-[attr(data-n)]" />
              )}
            </span>
            {expanded && <span className="hidden xl:inline">{n.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountButton({ me, expanded }: { me: ShellMe; expanded: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = "block rounded-md px-3 py-2 text-sm hover:bg-raised";
  return (
    <div ref={box} className="relative">
      {open && (
        <div id={id} className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
          <Link ref={first} href={`/u/${me.username}`} className={item} onClick={() => setOpen(false)}>
            Your profile
          </Link>
          <Link href="/app/settings" className={item} onClick={() => setOpen(false)}>
            Settings
          </Link>
          <a href="/download" className={item}>
            Desktop app
          </a>
          <form action="/auth/signout" method="post" className="border-t border-line pt-1.5 mt-1.5">
            <button className={`${item} w-full text-left`}>Sign out @{me.username}</button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Account menu, ${me.display_name} @${me.username}`}
        className={`flex w-full items-center justify-center gap-3 rounded-xl p-2 hover:bg-raised ${expanded ? "xl:justify-start" : ""}`}
      >
        <Avatar profile={me} size={40} />
        {expanded && (
          <span className="hidden min-w-0 flex-1 text-left leading-tight xl:block">
            <span className="block truncate text-[15px] font-semibold">{me.display_name}</span>
            <span className="block truncate text-sm text-muted">@{me.username}</span>
          </span>
        )}
        {expanded && <MoreIcon className="hidden h-5 w-5 text-muted xl:block" />}
      </button>
    </div>
  );
}
