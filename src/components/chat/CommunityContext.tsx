"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { syncFromServer } from "@/lib/rooms";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Community, Profile, Role, Room, RoomPin, RoomSection, Unread } from "@/lib/types";

export interface CommunityCtx {
  me: Profile;
  role: Role;
  community: Community;
  communities: Community[];
  rooms: Room[];
  setRooms: React.Dispatch<React.SetStateAction<Room[]>>;
  sections: RoomSection[];
  setSections: React.Dispatch<React.SetStateAction<RoomSection[]>>;
  /** Your own pins in this community (personal; never shown to anyone else). */
  pins: RoomPin[];
  /** Pin or unpin a room, optimistically. Resolves to an error to show, or null. */
  togglePin: (roomId: string) => Promise<string | null>;
  unreads: Record<string, Unread>;
  setUnreads: React.Dispatch<React.SetStateAction<Record<string, Unread>>>;
  currentRoomId: React.MutableRefObject<string | null>;
  profiles: Record<string, Profile>;
  ensureProfiles: (ids: string[]) => void;
  addProfiles: (list: Profile[]) => void;
  livekit: boolean;
  /** Phones: show the rooms (slide the chat away) or the chat. Stable. Read the state with useNavOpen(). */
  setNavOpen: (open: boolean) => void;
}

const Ctx = createContext<CommunityCtx | null>(null);
// Its own context: opening the rooms on a phone must re-render the stage, not every message on screen.
const NavCtx = createContext(false);

/** Whether the phone navigation (rooms) is showing. Only ChatStage needs this. */
export function useNavOpen(): boolean {
  return useContext(NavCtx);
}

// Switching communities from the rail on a phone keeps the rooms showing in the new community (its provider is a new
// one, so the choice rides over in this flag).
let carryNavOpen = false;
export function keepNavOpenForNextCommunity(): void {
  carryNavOpen = true;
}
function takeNavOpen(): boolean {
  // Cleared after this turn, not at once: Strict Mode calls state initialisers twice.
  if (carryNavOpen) setTimeout(() => (carryNavOpen = false), 0);
  return carryNavOpen;
}

export function useCommunity(): CommunityCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCommunity outside CommunityProvider");
  return v;
}

/** The community context, or null outside a community (the standalone DM pages). */
export function useOptionalCommunity(): CommunityCtx | null {
  return useContext(Ctx);
}

export function CommunityProvider({
  me,
  role,
  community,
  communities,
  initialRooms,
  initialSections,
  initialPins,
  livekit,
  children,
}: {
  me: Profile;
  role: Role;
  community: Community;
  communities: Community[];
  initialRooms: Room[];
  initialSections: RoomSection[];
  initialPins: RoomPin[];
  livekit: boolean;
  children: React.ReactNode;
}) {
  const [rooms, setRooms] = useState(initialRooms);
  const [sections, setSections] = useState(initialSections);
  const [pins, setPins] = useState(initialPins);
  const pinsRef = useRef(initialPins);
  pinsRef.current = pins;

  // A fresh server payload (router.refresh() after an edit, or coming back into the community) always wins over
  // what this browser had. Without this, the router cache can remount the provider with an old room list.
  const [server, setServer] = useState({ rooms: initialRooms, sections: initialSections, pins: initialPins });
  if (server.rooms !== initialRooms || server.sections !== initialSections || server.pins !== initialPins) {
    setServer({ rooms: initialRooms, sections: initialSections, pins: initialPins });
    setRooms((cur) => syncFromServer(cur, server.rooms, initialRooms));
    setSections((cur) => syncFromServer(cur, server.sections, initialSections));
    setPins((cur) => syncFromServer(cur, server.pins, initialPins));
  }

  // The payload itself can be a cached one (back/forward). Re-read the lists once per visit so they're current;
  // after that, the community broadcast (rooms_broadcast / room_sections_broadcast) keeps them live.
  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseBrowser();
    (async () => {
      const [{ data: r }, { data: s }, { data: p }] = await Promise.all([
        supabase.from("rooms").select("*").eq("community_id", community.id).order("position").order("name"),
        supabase.from("room_sections").select("id, community_id, name, position").eq("community_id", community.id).order("position").order("name"),
        supabase.from("room_pins").select("room_id, created_at").order("created_at"),
      ]);
      if (cancelled) return;
      if (r) setRooms(r as Room[]);
      if (s) setSections(s as RoomSection[]);
      if (r && p) {
        const ids = new Set((r as Room[]).map((x) => x.id));
        setPins((p as RoomPin[]).filter((x) => ids.has(x.room_id)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [community.id]);
  const [unreads, setUnreads] = useState<Record<string, Unread>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({ [me.id]: me });
  const [navOpen, setNavOpen] = useState(takeNavOpen);
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
        const { data } = await supabaseBrowser().from("profiles").select("id, username, display_name, avatar_url, is_bot").in("id", batch);
        addProfiles((data ?? []) as Profile[]);
      }, 30);
    },
    [addProfiles],
  );

  const togglePin = useCallback(
    async (roomId: string): Promise<string | null> => {
      const supabase = supabaseBrowser();
      const existing = pinsRef.current.find((p) => p.room_id === roomId);
      if (existing) {
        setPins((list) => list.filter((p) => p.room_id !== roomId));
        const { error } = await supabase.from("room_pins").delete().eq("user_id", me.id).eq("room_id", roomId);
        if (error) {
          setPins((list) => (list.some((p) => p.room_id === roomId) ? list : [...list, existing]));
          return "Couldn't unpin that room.";
        }
        return null;
      }
      const pin = { room_id: roomId, created_at: new Date().toISOString() };
      setPins((list) => [...list.filter((p) => p.room_id !== roomId), pin]);
      const { error } = await supabase.from("room_pins").insert({ user_id: me.id, room_id: roomId });
      if (error) {
        setPins((list) => list.filter((p) => p !== pin));
        return cloudErrorText(error.message) ?? "Couldn't pin that room.";
      }
      return null;
    },
    [me.id],
  );

  // One value object per real change, so context consumers don't all re-render whenever this provider does.
  const value = useMemo(
    () => ({
      me,
      role,
      community,
      communities,
      rooms,
      setRooms,
      sections,
      setSections,
      pins,
      togglePin,
      unreads,
      setUnreads,
      currentRoomId,
      profiles,
      ensureProfiles,
      addProfiles,
      livekit,
      setNavOpen,
    }),
    [me, role, community, communities, rooms, sections, pins, togglePin, unreads, profiles, ensureProfiles, addProfiles, livekit],
  );

  return (
    <Ctx.Provider value={value}>
      <NavCtx.Provider value={navOpen}>{children}</NavCtx.Provider>
    </Ctx.Provider>
  );
}
