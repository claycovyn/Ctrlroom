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
  ensureProfiles: (ids: string[]) => void;
  addProfiles: (list: Profile[]) => void;
  livekit: boolean;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

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
  const [navOpen, setNavOpen] = useState(false);
  const currentRoomId = useRef<string | null>(null);
  const known = useRef(new Set<string>([me.id]));
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
        const { data } = await supabaseBrowser().from("profiles").select("id, username, display_name, avatar_url").in("id", batch);
        addProfiles((data ?? []) as Profile[]);
      }, 30);
    },
    [addProfiles],
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
        ensureProfiles,
        addProfiles,
        livekit,
        navOpen,
        setNavOpen,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
