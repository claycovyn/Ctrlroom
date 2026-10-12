"use client";

import { useEffect, useRef } from "react";
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
