"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  callRooms,
  callStarts,
  displayStatus,
  initialPresence,
  mergePresence,
  payloadFor,
  presenceTopic,
  readManual,
  reducePresence,
  selfPeer,
  statusLabel,
  writeManual,
  type CallInfo,
  type DisplayStatus,
  type ManualStatus,
  type PeerPresence,
} from "@/lib/presence";
import { play, setDoNotDisturb } from "@/lib/sounds";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCommunity } from "./CommunityContext";

export interface PresenceCtx {
  /** Your status-menu choice. */
  manual: ManualStatus;
  setManual: (m: ManualStatus) => void;
  /** Everyone tracked in this community (you included, as you show to others). */
  peers: Record<string, PeerPresence>;
  /** Room id → people in a call there. */
  calls: Record<string, string[]>;
  statusOf: (userId: string) => { status: DisplayStatus; label: string; peer: PeerPresence | undefined };
  /** CallPanel reports joining, leaving and camera on/off. */
  setMyCall: (call: CallInfo | null) => void;
  /** A call just started in the room you're looking at (sound loops until you join or dismiss, 20 s at most). */
  incoming: { room_id: string; by: string } | null;
  dismissIncoming: () => void;
}

const Ctx = createContext<PresenceCtx | null>(null);

/** Null outside a community (e.g. Avatar on the home page): show no status. */
export function usePresence(): PresenceCtx | null {
  return useContext(Ctx);
}

const TICK_MS = 15_000;
const RING_MS = 20_000;
/** Calls already going when you open the community aren't "starting". */
const SETTLE_MS = 3_000;

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { me, community, rooms, currentRoomId } = useCommunity();
  const [local, dispatch] = useReducer(reducePresence, undefined, () => initialPresence("auto", Date.now()));
  const [others, setOthers] = useState<Record<string, PeerPresence>>({});
  const [incoming, setIncoming] = useState<{ room_id: string; by: string } | null>(null);
  const lastActive = useRef(Date.now());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedRef = useRef(false);
  const localRef = useRef(local);
  localRef.current = local;

  // The saved status-menu choice (per device).
  useEffect(() => {
    const m = readManual();
    if (m !== "auto") dispatch({ type: "manual", manual: m, now: Date.now(), lastActive: lastActive.current });
  }, []);

  const setManual = useCallback((m: ManualStatus) => {
    writeManual(m);
    lastActive.current = Date.now();
    dispatch({ type: "manual", manual: m, now: Date.now(), lastActive: lastActive.current });
  }, []);

  useEffect(() => setDoNotDisturb(local.manual === "dnd"), [local.manual]);
  useEffect(() => () => setDoNotDisturb(false), []);

  // Input and tab visibility. Input only touches a ref; the reducer runs on the tick, or at once when coming back.
  useEffect(() => {
    const active = () => {
      lastActive.current = Date.now();
      if (localRef.current.status === "away") dispatch({ type: "tick", now: Date.now(), lastActive: lastActive.current });
    };
    const vis = () => {
      if (!document.hidden) active();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, active, { passive: true }));
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => dispatch({ type: "tick", now: Date.now(), lastActive: lastActive.current }), TICK_MS);
    return () => {
      events.forEach((e) => window.removeEventListener(e, active));
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
    };
  }, []);

  const setMyCall = useCallback((call: CallInfo | null) => {
    lastActive.current = Date.now();
    dispatch({ type: "call", call, now: Date.now() });
  }, []);

  // The channel: always listen (you can see who's here while appearing offline); track only when visible.
  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(presenceTopic(community.id), { config: { private: true, presence: { key: me.id } } });
      channel.on("presence", { event: "sync" }, () => {
        if (channel) setOthers(mergePresence(channel.presenceState() as Record<string, unknown[]>));
      });
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED" || !channel) return;
        joinedRef.current = true;
        const payload = payloadFor(localRef.current, me.id);
        if (payload) channel.track(payload);
      });
      channelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      joinedRef.current = false;
      channelRef.current = null;
      setOthers({});
      if (channel) supabase.removeChannel(channel);
    };
  }, [community.id, me.id]);

  // Re-track only when what others see changes (status, call, or appearing offline).
  const payloadKey = local.manual === "invisible" ? "off" : `${local.status}|${local.call?.room_id ?? ""}|${local.call?.video ?? ""}`;
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !joinedRef.current) return;
    const payload = payloadFor(localRef.current, me.id);
    if (payload) channel.track(payload);
    else channel.untrack();
  }, [payloadKey, me.id]);

  // Your own entry always reflects this tab right away (and Appear offline hides you from yourself too).
  const peers = useMemo(() => {
    const next = { ...others };
    delete next[me.id];
    const mine = selfPeer(local);
    // Other tabs of yours still count (e.g. a call in another window), unless this one is appearing offline.
    if (mine) next[me.id] = others[me.id] && !mine.call && others[me.id].call ? { ...mine, call: others[me.id].call } : mine;
    return next;
  }, [others, local, me.id]);

  const calls = useMemo(() => callRooms(peers), [peers]);

  // Call starts in the room you're looking at → ring (unless you're already in a call; DND is handled by play()).
  const prevCalls = useRef<Record<string, string[]> | null>(null);
  const openedAt = useRef(Date.now());
  useEffect(() => {
    const prev = prevCalls.current;
    prevCalls.current = calls;
    if (!prev || Date.now() - openedAt.current < SETTLE_MS) return;
    if (local.call) return;
    const start = callStarts(prev, calls, me.id).find((s) => s.room_id === currentRoomId.current);
    if (start) setIncoming(start);
  }, [calls, local.call, me.id, currentRoomId]);

  // Stop ringing when you join any call, or the call ends before you pick up.
  useEffect(() => {
    if (!incoming) return;
    if (local.call || !(calls[incoming.room_id] ?? []).some((id) => id !== me.id)) setIncoming(null);
  }, [incoming, local.call, calls, me.id]);

  useEffect(() => {
    if (!incoming) return;
    const stop = play("call-incoming", { loop: true });
    const t = setTimeout(() => setIncoming(null), RING_MS);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, [incoming]);

  const dismissIncoming = useCallback(() => setIncoming(null), []);

  const roomName = useCallback((id: string) => rooms.find((r) => r.id === id)?.name, [rooms]);
  const statusOf = useCallback(
    (userId: string) => {
      const peer = peers[userId];
      return { status: displayStatus(peer), label: statusLabel(peer, roomName), peer };
    },
    [peers, roomName],
  );

  return (
    <Ctx.Provider value={{ manual: local.manual, setManual, peers, calls, statusOf, setMyCall, incoming, dismissIncoming }}>{children}</Ctx.Provider>
  );
}
