"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { badgeCount, type DmConversation } from "@/lib/dms";
import { UserTopicProvider, useUserTopicHub } from "@/lib/realtime";
import { DM_READ_EVENT, SEEN_EVENT, type ShellCommunity, type ShellMe } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Spine } from "./Spine";

type SpineCtx = { dms: number; activity: number; setAccount: (fn: (() => void) | null) => void };
const Ctx = createContext<SpineCtx | null>(null);

/** The badges the Spine shows, and a way for the page under it to take over the account button. */
export const useSpine = () => useContext(Ctx);

/**
 * The frame around everything signed in: the Feed, profiles, DMs and every community (operator, 2026-10-17: tapping
 * into a community keeps the nav and swaps the content). A layout above both, so the Spine and its live badges stay
 * mounted while you move; it also owns your Realtime topic, which the pages under it share.
 */
export function SpineFrame({ me, communities, children }: { me: ShellMe; communities: ShellCommunity[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeCommunity = /^\/c\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const [dms, setDms] = useState(0);
  const [activity, setActivity] = useState(0);
  const onActivity = useRef(false);
  onActivity.current = pathname.startsWith("/app/feed/activity");

  const loadDms = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("my_dm_inbox");
    setDms(badgeCount((data ?? []) as DmConversation[]));
  }, []);

  useEffect(() => {
    let live = true;
    void loadDms();
    // On the Activity page itself everything is being marked seen.
    void supabaseBrowser()
      .rpc("my_activity_unseen")
      .then(({ data }) => live && setActivity(onActivity.current ? 0 : Number(data ?? 0)));
    return () => {
      live = false;
    };
  }, [loadDms]);

  useEffect(() => {
    const seen = () => setActivity(0);
    const read = () => void loadDms();
    window.addEventListener(SEEN_EVENT, seen);
    window.addEventListener(DM_READ_EVENT, read);
    return () => {
      window.removeEventListener(SEEN_EVENT, seen);
      window.removeEventListener(DM_READ_EVENT, read);
    };
  }, [loadDms]);

  const hub = useUserTopicHub(me.id);
  const dmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const refreshDms = () => {
      clearTimeout(dmTimer.current);
      dmTimer.current = setTimeout(() => void loadDms(), 400);
    };
    const bump = () => !onActivity.current && setActivity((n) => n + 1);
    return hub.add({ current: { follow: bump, follow_approved: bump, post_like: bump, post_reply: bump, dm: refreshDms, dm_conversation: refreshDms } });
  }, [hub, loadDms]);

  // Communities are read once with the frame; one you just joined isn't in the list yet, so fetch it once.
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    if (!activeCommunity || communities.some((c) => c.slug === activeCommunity) || refreshed.current.has(activeCommunity)) return;
    refreshed.current.add(activeCommunity);
    router.refresh();
  }, [activeCommunity, communities, router]);

  const account = useRef<(() => void) | null>(null);
  const setAccount = useCallback((fn: (() => void) | null) => {
    account.current = fn;
  }, []);
  const ctx = useMemo(() => ({ dms, activity, setAccount }), [dms, activity, setAccount]);

  return (
    <UserTopicProvider value={hub}>
      <Ctx.Provider value={ctx}>
        <div className="flex min-h-dvh bg-bg">
          <Spine
            me={me}
            communities={communities}
            dms={dms}
            activity={activity}
            activeCommunity={activeCommunity}
            onAccount={() => (account.current ? account.current() : router.push(`/u/${me.username}`))}
            className="cr-spine sticky top-0"
          />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </Ctx.Provider>
    </UserTopicProvider>
  );
}
