"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (payload: any) => void>;

/**
 * Subscribes to a private Realtime broadcast topic (see the migration header for topics).
 * Handlers can change between renders; the set of event names is read once per topic.
 */
export function useBroadcast(topic: string | null, handlers: Handlers) {
  const handlersRef = useRef(handlers);
  const channelRef = useRef<RealtimeChannel | null>(null);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!topic) return;
    const supabase = supabaseBrowser();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
      for (const event of Object.keys(handlersRef.current)) {
        channel.on("broadcast", { event }, (msg) => handlersRef.current[event]?.(msg.payload));
      }
      channel.subscribe();
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [topic]);

  return channelRef;
}

/**
 * Your own topic (user:<id>) is one Realtime channel per tab, so two components subscribing to it would share it and
 * the first to unmount would tear it down for the other. The Spine frame owns it instead (it stays mounted across the
 * Feed, DMs and every community) and fans each event out to whoever registered with useUserBroadcast.
 */
type UserTopicHub = { add: (h: { current: Handlers }) => () => void };
const UserTopic = createContext<UserTopicHub | null>(null);
export const UserTopicProvider = UserTopic.Provider;

/** For the frame: subscribes to user:<id> once, for every event, and returns the hub to provide. */
export function useUserTopicHub(meId: string): UserTopicHub {
  const listeners = useRef(new Set<{ current: Handlers }>());
  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(`user:${meId}`, { config: { private: true, broadcast: { self: false } } });
      channel.on("broadcast", { event: "*" }, (msg) => {
        for (const l of listeners.current) l.current[msg.event]?.(msg.payload);
      });
      channel.subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [meId]);
  return useMemo(() => ({ add: (h) => (listeners.current.add(h), () => void listeners.current.delete(h)) }), []);
}

/** Events on your own topic. Inside the Spine frame they come from its one channel; elsewhere this subscribes itself. */
export function useUserBroadcast(meId: string | null, handlers: Handlers) {
  const hub = useContext(UserTopic);
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => (hub && meId ? hub.add(ref) : undefined), [hub, meId]);
  useBroadcast(!hub && meId ? `user:${meId}` : null, handlers);
}
