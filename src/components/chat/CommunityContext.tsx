"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Community, Profile, Role, Room, Unread } from "@/lib/types";

export interface CommunityCtx {
  me: Profile;
  role: Role;
  community: Community;
  communities: Community[];
  rooms: Room[];
  setRooms: React.Dispatch<React.SetStateAction<Room[]>>;
  unreads: Record<string, Unread>;
  setUnreads: React.Dispatch<React.SetStateAction<Record<string, Unread>>>;
  currentRoomId: React.MutableRefObject<string | null>;
  profiles: Record<string, Profile>;
  /** Lifetime points in this community, per member (drives level badges). */
  points: Record<string, number>;
  ensureProfiles: (ids: string[]) => void;
  addProfiles: (list: Profile[]) => void;
  addPoints: (map: Record<string, number>) => void;
  /** Re-read members' points after something that may have awarded some (likes, answers). */
  refreshPoints: (ids: string[]) => void;
  /** Community-topic events (posts, calendar) fanned out from the sidebar's one subscription. */
  onCommunityEvent: (fn: CommunityListener) => () => void;
  emitCommunityEvent: (event: string, payload: unknown) => void;
  livekit: boolean;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommunityListener = (event: string, payload: any) => void;

const Ctx = createContext<CommunityCtx | null>(null);

export function useCommunity(): CommunityCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCommunity outside CommunityProvider");
  return v;
}

export function CommunityProvider({
  me,
  role,
  community,
  communities,
  initialRooms,
  livekit,
  children,
}: {
  me: Profile;
  role: Role;
  community: Community;
  communities: Community[];
  initialRooms: Room[];
  livekit: boolean;
  children: React.ReactNode;
}) {
  const [rooms, setRooms] = useState(initialRooms);
  const [unreads, setUnreads] = useState<Record<string, Unread>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({ [me.id]: me });
  const [points, setPoints] = useState<Record<string, number>>({});
  const refreshPoints = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { data } = await supabaseBrowser()
        .from("community_members")
        .select("user_id, points")
        .eq("community_id", community.id)
        .in("user_id", ids);
      setPoints((prev) => ({ ...prev, ...Object.fromEntries(((data ?? []) as { user_id: string; points: number }[]).map((r) => [r.user_id, r.points])) }));
    },
    [community.id],
  );
  const listeners = useRef(new Set<CommunityListener>());
  const onCommunityEvent = useCallback((fn: CommunityListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  const emitCommunityEvent = useCallback((event: string, payload: unknown) => {
    listeners.current.forEach((fn) => fn(event, payload));
  }, []);
  const addPoints = useCallback((map: Record<string, number>) => setPoints((prev) => ({ ...prev, ...map })), []);
  const [navOpen, setNavOpen] = useState(false);
  const currentRoomId = useRef<string | null>(null);
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addProfiles = useCallback((list: Profile[]) => {
    if (!list.length) return;
    list.forEach((p) => known.current.add(p.id));
    setProfiles((prev) => {
      const next = { ...prev };
      list.forEach((p) => (next[p.id] = p));
      return next;
    });
  }, []);

  // Batches lookups of authors we haven't seen yet (new members posting, old history).
  const ensureProfiles = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => {
        if (!known.current.has(id)) pending.current.add(id);
      });
      if (!pending.current.size || timer.current) return;
      timer.current = setTimeout(async () => {
        timer.current = null;
        const batch = [...pending.current];
        pending.current.clear();
        batch.forEach((id) => known.current.add(id));
        const { data } = await supabaseBrowser()
          .from("community_members")
          .select("user_id, points, profiles(id, username, display_name, avatar_url)")
          .eq("community_id", community.id)
          .in("user_id", batch);
        const rows = (data ?? []) as unknown as { user_id: string; points: number; profiles: Profile | null }[];
        addProfiles(rows.flatMap((r) => (r.profiles ? [r.profiles] : [])));
        addPoints(Object.fromEntries(rows.map((r) => [r.user_id, r.points])));
        // People who left the community: fall back to the profile alone (if still visible).
        const missing = batch.filter((id) => !rows.some((r) => r.user_id === id));
        if (missing.length) {
          const { data: rest } = await supabaseBrowser().from("profiles").select("id, username, display_name, avatar_url").in("id", missing);
          addProfiles((rest ?? []) as Profile[]);
        }
      }, 30);
    },
    [addProfiles, addPoints, community.id],
  );

  return (
    <Ctx.Provider
      value={{
        me,
        role,
        community,
        communities,
        rooms,
        setRooms,
        unreads,
        setUnreads,
        currentRoomId,
        profiles,
        points,
        ensureProfiles,
        addProfiles,
        addPoints,
        refreshPoints,
        onCommunityEvent,
        emitCommunityEvent,
        livekit,
        navOpen,
        setNavOpen,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
