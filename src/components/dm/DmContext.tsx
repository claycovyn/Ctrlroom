"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyIncoming, badgeCount, dmAlert, markRead, type DmConversation, type DmEvent, type DmMessage, type DmReaction } from "@/lib/dms";
import { readManual } from "@/lib/presence";
import { isPushActive } from "@/lib/pushClient";
import { useUserBroadcast } from "@/lib/realtime";
import { installSoundUnlock, play } from "@/lib/sounds";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { usePresence } from "@/components/chat/PresenceContext";
import { DM_READ_EVENT } from "@/lib/shell";

/** Marks a conversation read. A query only runs once awaited or then'd, so this always thens it, then tells the shell. */
export function markDmRead(id: string): Promise<void> {
  return Promise.resolve(supabaseBrowser().rpc("mark_dm_read", { p_conv: id })).then(({ error }) => {
    if (!error && typeof window !== "undefined") window.dispatchEvent(new Event(DM_READ_EVENT));
  });
}

/** What an open conversation hears about (the inbox handles the rest). */
export type DmLiveEvent =
  | { type: "message"; message: DmMessage }
  | { type: "update"; message: DmMessage }
  | { type: "reaction"; op: "add" | "remove"; reaction: DmReaction; conversation_id: string }
  | { type: "conversation"; conversation_id: string };

export interface DmCtx {
  me: Profile;
  /** Where the DM pages are: /c/<slug>/dm inside a community, /app/dm outside one. */
  base: string;
  conversations: DmConversation[];
  loaded: boolean;
  refresh: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<DmConversation[]>>;
  /** The rail badge: unread in unmuted chats plus open requests. */
  badge: number;
  /** People you blocked. */
  blocked: Set<string>;
  refreshBlocks: () => Promise<void>;
  /** The conversation on screen, if any. */
  viewing: React.MutableRefObject<string | null>;
  markConversationRead: (id: string) => void;
  /** Open conversations subscribe here for live messages, edits and reactions. */
  subscribe: (fn: (e: DmLiveEvent) => void) => () => void;
  /** Handlers for the dm events on your user:<id> topic. */
  handlers: Record<"dm" | "dm_update" | "dm_reaction" | "dm_conversation", (payload: unknown) => void>;
}

type ReactionEvent = { op: "add" | "remove"; message_id: string; user_id: string; emoji: string; conversation_id: string };

const Ctx = createContext<DmCtx | null>(null);

export function useDm(): DmCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDm outside DmProvider");
  return v;
}

/** Null where DMs aren't mounted (e.g. the screenshot harness for rooms). */
export function useOptionalDm(): DmCtx | null {
  return useContext(Ctx);
}

/**
 * Inbox state, unread counts, sounds and desktop alerts for direct messages. Inside a community the Sidebar already
 * owns the user:<id> channel (one channel per topic), so it forwards the dm events here (`handlers`); outside one,
 * pass `listen` and this subscribes itself.
 */
export function DmProvider({ me, base, listen = false, children }: { me: Profile; base: string; listen?: boolean; children: React.ReactNode }) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const viewing = useRef<string | null>(null);
  const listeners = useRef(new Set<(e: DmLiveEvent) => void>());
  const presence = usePresence();
  const dndRef = useRef(false);
  dndRef.current = presence ? presence.manual === "dnd" : readManual() === "dnd";
  const convRef = useRef(conversations);
  convRef.current = conversations;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const refresh = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("my_dm_inbox");
    if (!error) {
      const list = (data ?? []) as DmConversation[];
      // The conversation on screen is being read right now.
      setConversations(viewing.current ? list.map((c) => (c.id === viewing.current ? { ...c, unread: 0 } : c)) : list);
    }
    setLoaded(true);
  }, []);

  const refreshBlocks = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("my_blocks");
    setBlocked(new Set(((data ?? []) as { id: string }[]).map((b) => b.id)));
  }, []);

  useEffect(() => {
    installSoundUnlock();
    refresh();
    refreshBlocks();
  }, [refresh, refreshBlocks]);

  // Coming back to the tab: catch up on anything missed while the socket was asleep.
  useEffect(() => {
    const vis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [refresh]);

  const emit = (e: DmLiveEvent) => listeners.current.forEach((fn) => fn(e));

  const markConversationRead = useCallback((id: string) => {
    setConversations((list) => markRead(list, id, new Date().toISOString()));
    void markDmRead(id);
  }, []);

  const alertFor = (e: DmEvent) => {
    const { sound, alert } = dmAlert(e, {
      meId: me.id,
      viewingId: viewing.current,
      hidden: document.hidden,
      blocked: blockedRef.current,
      dnd: dndRef.current,
    });
    if (sound) play("dm", { roomNotify: e.muted ? "none" : "mentions" });
    // With push on for this device the service worker shows it (0014 dm_messages_push); don't show it twice.
    if (alert && !isPushActive() && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const url = `${base}/${e.conversation_id}`;
      const n = new Notification(e.status === "request" ? `Message request from ${e.author}` : e.author, {
        body: e.message.body.slice(0, 140) || "Sent a file",
        tag: url,
      });
      n.onclick = () => {
        window.focus();
        window.location.href = url;
      };
    }
  };

  const handlers = {
    dm: (e: DmEvent) => {
      if (blockedRef.current.has(e.message.author_id) && e.message.author_id !== me.id) return;
      alertFor(e);
      // Not in the inbox yet (a new request, or someone added you): fetch it.
      if (!convRef.current.some((c) => c.id === e.conversation_id)) refresh();
      else setConversations((list) => applyIncoming(list, e, me.id, viewing.current) ?? list);
      emit({ type: "message", message: e.message });
      if (viewing.current === e.conversation_id && !document.hidden) void markDmRead(e.conversation_id);
    },
    dm_update: (p: { message: DmMessage }) => {
      setConversations((list) =>
        list.map((c) =>
          c.last_message?.id === p.message.id
            ? { ...c, last_message: { ...c.last_message, body: p.message.body.slice(0, 140), deleted: Boolean(p.message.deleted_at) } }
            : c,
        ),
      );
      emit({ type: "update", message: p.message });
    },
    dm_reaction: (p: ReactionEvent) =>
      emit({ type: "reaction", op: p.op, conversation_id: p.conversation_id, reaction: { message_id: p.message_id, user_id: p.user_id, emoji: p.emoji } }),
    dm_conversation: (p: { conversation_id: string }) => {
      refresh();
      emit({ type: "conversation", conversation_id: p.conversation_id });
    },
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  // Stable wrappers, so the Sidebar's channel always calls the latest handlers.
  const stable = useMemo(
    () => ({
      dm: (p: unknown) => handlersRef.current.dm(p as DmEvent),
      dm_update: (p: unknown) => handlersRef.current.dm_update(p as { message: DmMessage }),
      dm_reaction: (p: unknown) => handlersRef.current.dm_reaction(p as ReactionEvent),
      dm_conversation: (p: unknown) => handlersRef.current.dm_conversation(p as { conversation_id: string }),
    }),
    [],
  );

  useUserBroadcast(listen ? me.id : null, stable);

  const subscribe = useCallback((fn: (e: DmLiveEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const badge = useMemo(() => badgeCount(conversations), [conversations]);
  // One value per real change: this provider re-renders with presence (for Do not disturb), its consumers needn't.
  const value = useMemo(
    () => ({ me, base, conversations, loaded, refresh, setConversations, badge, blocked, refreshBlocks, viewing, markConversationRead, subscribe, handlers: stable }),
    [me, base, conversations, loaded, refresh, badge, blocked, refreshBlocks, markConversationRead, subscribe, stable],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
