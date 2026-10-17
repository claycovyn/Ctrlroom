"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { badgeCount, type DmConversation } from "@/lib/dms";
import { useBroadcast } from "@/lib/realtime";
import { activityOf, DM_READ_EVENT, navKeyFor, POST_EVENT, SEEN_EVENT, type CommunityActivity, type ShellCommunity, type ShellMe } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Unread } from "@/lib/types";
import { CommunitiesAside } from "./CommunitiesPanel";
import { Ctx, type ShellCtx, type ShellSheet } from "./ShellContext";
import { Spine } from "./Spine";
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

  return (
    <Ctx.Provider value={ctx}>
      <div className={`${s.root} min-h-dvh bg-bg`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm">
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          {/* The one spine — the same rail the communities use, so the whole app is one frame. */}
          <Spine me={me} communities={communities} dms={dms} activity={social} onAccount={() => open("account")} />
          <div className="mx-auto flex min-w-0 max-w-[1205px] flex-1 justify-center">
            <main id="main" className="min-h-dvh w-full min-w-0 max-w-[600px] md:border-x md:border-line" tabIndex={-1}>
              {children}
            </main>
            {/* Right column from 1024px. */}
            <aside className="sticky top-0 hidden h-dvh w-[316px] shrink-0 overflow-y-auto py-3 pl-6 scroll-thin lg:block xl:w-[350px]" aria-label="Your communities">
              <CommunitiesAside />
            </aside>
          </div>
        </div>

        {sheet && <Sheets sheet={sheet} onClose={() => setSheet(null)} />}
      </div>
    </Ctx.Provider>
  );
}

