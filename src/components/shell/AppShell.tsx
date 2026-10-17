"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserBroadcast } from "@/lib/realtime";
import { activityOf, POST_EVENT, type CommunityActivity, type ShellCommunity, type ShellMe } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Unread } from "@/lib/types";
import { CommunitiesAside } from "./CommunitiesPanel";
import { Ctx, type ShellCtx, type ShellSheet } from "./ShellContext";
import { useSpine } from "./SpineContext";
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
 * The signed-in social shell: the page in the middle and your communities on the right from 1024px, beside the Spine
 * (SpineShell, which also keeps the DM and Activity badges). Mounted by the (shell) layout, so it stays put while you
 * move between the Feed, profiles and Settings.
 */
export function AppShell({ me, communities, cloud, children }: { me: ShellMe; communities: ShellCommunity[]; cloud: boolean; children: React.ReactNode }) {
  const spine = useSpine();
  const [sheet, setSheet] = useState<ShellSheet>(null);
  const [activity, setActivity] = useState<Record<string, CommunityActivity>>({});
  const [activityLoaded, setActivityLoaded] = useState(false);

  // Community activity for the right column loads once the page is up; the shell stays mounted, so once per visit.
  const ids = communities.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    const cancel = whenIdle(() => {
      const sb = supabaseBrowser();
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
  }, [ids]);

  // New posts from private accounts you follow (passed on to the Feed) and mentions for the right column.
  useUserBroadcast(me.id, {
    post: (p: unknown) => window.dispatchEvent(new CustomEvent(POST_EVENT, { detail: p })),
    mention: (p: { community_id?: string }) => {
      if (!p?.community_id) return;
      setActivity((a) => {
        const cur = a[p.community_id!] ?? { rooms: 0, mentions: 0 };
        return { ...a, [p.community_id!]: { rooms: Math.max(cur.rooms, 1), mentions: cur.mentions + 1 } };
      });
    },
  });

  const open = useCallback((k: Exclude<ShellSheet, null>) => setSheet(k), []);
  // Here the Spine's account button opens the account sheet.
  const setAccount = spine?.setAccount;
  useEffect(() => {
    if (!setAccount) return;
    setAccount(() => open("account"));
    return () => setAccount(null);
  }, [setAccount, open]);

  const dms = spine?.dms ?? 0;
  const social = spine?.activity ?? 0;
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
        <div className="mx-auto flex min-w-0 max-w-[1205px] justify-center">
          <main id="main" className="min-h-dvh w-full min-w-0 max-w-[600px] md:border-x md:border-line" tabIndex={-1}>
            {children}
          </main>
          {/* Right column from 1024px. */}
          <aside className="sticky top-0 hidden h-dvh w-[316px] shrink-0 overflow-y-auto py-3 pl-6 scroll-thin lg:block xl:w-[350px]" aria-label="Your communities">
            <CommunitiesAside />
          </aside>
        </div>

        {sheet && <Sheets sheet={sheet} onClose={() => setSheet(null)} />}
      </div>
    </Ctx.Provider>
  );
}
