"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WITH_ATTACHMENTS } from "@/lib/attachments";
import { cloudErrorText } from "@/lib/cloudErrors";
import { buildRows, keepSameSummaries, summarizeReactions, upsertMessage, type ReactionSummary, type Row } from "@/lib/format";
import { useBroadcast } from "@/lib/realtime";
import { markPushMoment, nudgePush } from "@/lib/pushClient";
import { POST_ROLE_LABEL } from "@/lib/rooms";
import { play } from "@/lib/sounds";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type BoardItem, type CatchUp, type Message, type Profile, type Reaction, type Room, type Unread, type AgentJob } from "@/lib/types";
import { CatchUpBanner } from "./CatchUpBanner";
import { useCommunity } from "./CommunityContext";
import { purgeAttachments } from "./attachments/signedUrls";
import type { OutgoingAttachment } from "./attachments/useAttachmentDrafts";
import { Composer } from "./Composer";
import { BellIcon, BellOffIcon, BoardIcon, HeadsetIcon, InfoIcon, MenuIcon, PhoneIcon, PinIcon, SearchIcon, SettingsIcon, UsersIcon } from "./icons";
import { PresenceAvatar } from "./PresenceAvatar";
import { usePresence } from "./PresenceContext";
import { RoomIcon } from "./RoomIcon";
import { LinkedText } from "./LinkedText";
import { Panel } from "./Panel";
import { MessageItem, type MessageActions } from "./MessageItem";
import { OPEN_PANEL, rememberRoom, ROOM_SHOWN } from "./roomNav";

const CallPanel = dynamic(() => import("./CallPanel"), { ssr: false });
// Panels open on a tap; they load in the background once the room is on screen (preloadPanels), not with the page.
const loadThread = () => import("./ThreadPanel");
const loadBoard = () => import("./BoardPanel");
const loadSearch = () => import("./SearchPanel");
const loadMembers = () => import("./MembersPanel");
const loadRoomEdit = () => import("./RoomEditDialog");
const ThreadPanel = dynamic(() => loadThread().then((m) => m.ThreadPanel), { ssr: false });
const BoardPanel = dynamic(() => loadBoard().then((m) => m.BoardPanel), { ssr: false });
const SearchPanel = dynamic(() => loadSearch().then((m) => m.SearchPanel), { ssr: false });
const MembersPanel = dynamic(() => loadMembers().then((m) => m.MembersPanel), { ssr: false });
const RoomEditDialog = dynamic(() => loadRoomEdit().then((m) => m.RoomEditDialog), { ssr: false });
let panelsPreloaded = false;
function preloadPanels() {
  if (panelsPreloaded) return;
  panelsPreloaded = true;
  const go = () => Promise.all([loadThread(), loadBoard(), loadSearch(), loadMembers(), loadRoomEdit()]).catch(() => (panelsPreloaded = false));
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

const PAGE = 50;
const BOT_MENTION = /(?:^|[^a-zA-Z0-9_])@(ctrl|openctrl)(?![a-zA-Z0-9_])/i;
const BOT_NAME = { ctrl: "Ctrl", openctrl: "OpenCtrl" } as const;

function agentLine(jobs: AgentJob[]): string | null {
  const j = jobs[jobs.length - 1];
  if (!j) return null;
  return `${BOT_NAME[j.bot]} ${j.status === "queued" ? "is on it…" : j.step ? `· ${j.step}` : "is thinking…"}`;
}
type PanelKind = "thread" | "board" | "search" | "members" | "info" | null;

/** A message id made in the browser (randomUUID needs https; this also works over plain http on a LAN). */
function newMessageId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function mergeReactions(list: Reaction[], add: Reaction[]): Reaction[] {
  const key = (r: Reaction) => `${r.message_id}|${r.user_id}|${r.emoji}`;
  const seen = new Set(list.map(key));
  return [...list, ...add.filter((r) => !seen.has(key(r)))];
}

export function RoomView({
  room: initialRoom,
  initialMessages,
  initialReactions,
  initialBoard,
  initialProfiles,
  hasMore,
  focusMessageId,
}: {
  room: Room;
  initialMessages: Message[];
  initialReactions: Reaction[];
  initialBoard: BoardItem[];
  initialProfiles: Profile[];
  hasMore: boolean;
  focusMessageId: string | null;
}) {
  const { me, role, community, rooms, pins, togglePin, profiles, ensureProfiles, addProfiles, currentRoomId, unreads, setUnreads, setNavOpen, livekit } =
    useCommunity();
  const supabase = supabaseBrowser();
  // The live room: edits (yours or another admin's, via the community broadcast) show without a reload.
  const room = rooms.find((r) => r.id === initialRoom.id) ?? initialRoom;
  const pinned = pins.some((p) => p.room_id === room.id);
  const canEdit = atLeast(role, "admin");
  const [editing, setEditing] = useState(false);

  const [messages, setMessages] = useState(initialMessages);
  const [reactions, setReactions] = useState(initialReactions);
  const [board, setBoard] = useState(initialBoard);
  const [more, setMore] = useState(hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [agents, setAgents] = useState<Record<string, AgentJob>>({});
  const [callOpen, setCallOpen] = useState(room.kind === "voice");
  const [joinNow, setJoinNow] = useState(0);
  const presence = usePresence();
  const ringing = presence?.incoming?.room_id === room.id ? presence.incoming : null;
  const inCall = presence?.calls[room.id] ?? [];
  const dismissIncoming = presence?.dismissIncoming;
  // Leaving the room stops a ring for it.
  useEffect(() => () => dismissIncoming?.(), [room.id, dismissIncoming]);
  const inCallKey = inCall.join(",");
  useEffect(() => {
    if (inCallKey) ensureProfiles(inCallKey.split(","));
  }, [inCallKey, ensureProfiles]);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(focusMessageId);

  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  // Messages that arrived while you're here (they animate in); and your own that are still on their way.
  const fresh = useRef(new Set<string>());
  const [outgoing, setOutgoing] = useState<Record<string, "sending" | "failed">>({});
  const scrollRestore = useRef<number | null>(null);
  const threadRootId = useRef<string | null>(null);
  threadRootId.current = threadRoot?.id ?? null;

  const notify = unreads[room.id]?.notify ?? "mentions";
  const canPost = atLeast(role, room.post_min_role);
  const canModerate = atLeast(role, "mod");
  // Per message, the same list as before when its reactions didn't change (the rows are memoized).
  const lastSummary = useRef<Map<string, ReactionSummary[]> | null>(null);
  const summary = useMemo(() => (lastSummary.current = keepSameSummaries(lastSummary.current, summarizeReactions(reactions, me.id))), [reactions, me.id]);
  const rows = useMemo(() => buildRows(messages), [messages]);

  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  // ── AI helpers: show jobs in progress, and pick up any that never started
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("bot_jobs")
      .select("id, bot, status, step, message_id, thread_id, requested_by, created_at")
      .eq("room_id", room.id)
      .in("status", ["queued", "running"])
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .then(({ data }) => {
        if (cancelled || !data?.length) return;
        setAgents(Object.fromEntries((data as (AgentJob & { created_at: string })[]).map((j) => [j.id, j])));
        if ((data as { status: string; created_at: string }[]).some((j) => j.status === "queued" && Date.now() - new Date(j.created_at).getTime() > 15_000)) {
          fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: room.id }) }).catch(() => {});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [room.id, supabase]);

  // ── mount: profiles, catch-up, mark read
  useEffect(() => {
    addProfiles(initialProfiles);
    currentRoomId.current = room.id;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("catch_up", { p_room: room.id });
      if (!cancelled && data && (data as CatchUp).new_messages > 0) setCatchUp(data as CatchUp);
      await supabase.rpc("mark_read", { p_room: room.id });
      setUnreads((u) => ({ ...u, [room.id]: { ...(u[room.id] ?? ({ room_id: room.id, notify: "mentions" } as Unread)), unread: 0, mentions: 0 } }));
    })();
    return () => {
      cancelled = true;
      if (currentRoomId.current === room.id) currentRoomId.current = null;
      supabase.rpc("mark_read", { p_room: room.id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Keep the room marked read while you're looking at it (at most every 5s).
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRead = useCallback(() => {
    if (readTimer.current || document.hidden) return;
    readTimer.current = setTimeout(() => {
      readTimer.current = null;
      supabase.rpc("mark_read", { p_room: room.id });
    }, 5000);
  }, [supabase, room.id]);

  // ── realtime
  const channel = useBroadcast(`room:${room.id}`, {
    message: (m: Message) => {
      ensureProfiles([m.author_id]);
      setTyping((t) => {
        if (!t[m.author_id]) return t;
        const next = { ...t };
        delete next[m.author_id];
        return next;
      });
      if (!m.parent_id) {
        fresh.current.add(m.id);
        setMessages((list) => upsertMessage(list, m));
        if (m.author_id !== me.id) touchRead();
      } else if (m.parent_id === threadRootId.current) {
        setThreadReplies((list) => upsertMessage(list, m));
      }
    },
    message_update: (m: Message) => {
      if (!m.parent_id) {
        setMessages((list) => (list.some((x) => x.id === m.id) ? upsertMessage(list, m) : list));
        if (m.id === threadRootId.current) setThreadRoot((r) => (r ? { ...r, ...m } : r));
      } else if (m.parent_id === threadRootId.current) {
        setThreadReplies((list) => (list.some((x) => x.id === m.id) ? upsertMessage(list, m) : list));
      }
      if (m.deleted_at) setReactions((list) => list.filter((r) => r.message_id !== m.id));
    },
    reaction_add: (r: Reaction) => setReactions((list) => mergeReactions(list, [r])),
    reaction_remove: (r: Reaction) =>
      setReactions((list) => list.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji))),
    board: (p: { op: string; item: BoardItem }) => {
      ensureProfiles([p.item.created_by]);
      setBoard((list) => {
        const rest = list.filter((i) => i.id !== p.item.id);
        return p.op === "delete" ? rest : [p.item, ...rest].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      });
    },
    agent: (j: AgentJob) => {
      setAgents((cur) => {
        const next = { ...cur };
        if (j.status === "done" || j.status === "failed") delete next[j.id];
        else next[j.id] = j;
        return next;
      });
    },
    typing: (p: { user_id: string; name: string }) => {
      if (p.user_id === me.id) return;
      setTyping((t) => ({ ...t, [p.user_id]: { name: p.name, at: Date.now() } }));
    },
  });

  useEffect(() => {
    const t = setInterval(() => {
      setTyping((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => now - v.at < 5000));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const sendTyping = () => {
    channel.current?.send({ type: "broadcast", event: "typing", payload: { user_id: me.id, name: me.display_name } });
  };

  // The end of a room switch (roomNav's view transition waits for this).
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent(ROOM_SHOWN));
  }, []);
  useEffect(preloadPanels, []);
  useEffect(() => rememberRoom(community.slug, room.slug), [community.slug, room.slug]);
  // The phone navigation's search field opens this room's search.
  useEffect(() => {
    const open = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (p === "search" || p === "members" || p === "board" || p === "info") setPanel(p);
    };
    window.addEventListener(OPEN_PANEL, open);
    return () => window.removeEventListener(OPEN_PANEL, open);
  }, []);

  // When the list gets shorter (the keyboard opens, the composer grows) keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── scrolling
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (scrollRestore.current !== null) {
      el.scrollTop = el.scrollHeight - scrollRestore.current;
      scrollRestore.current = null;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`m-${focusMessageId}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      nearBottom.current = false;
    } else {
      // An older message or a reply: open it as a thread.
      openThreadById(focusMessageId);
    }
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId]);

  const loadOlder = async () => {
    if (!more || loadingMore || !messages.length) return;
    setLoadingMore(true);
    const { data } = await supabase
      .from("messages")
      .select(WITH_ATTACHMENTS)
      .eq("room_id", room.id)
      .is("parent_id", null)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const older = ((data ?? []) as Message[]).reverse();
    if (older.length) {
      ensureProfiles([...new Set(older.map((m) => m.author_id))]);
      const { data: rx } = await supabase.from("reactions").select("message_id, user_id, emoji").in("message_id", older.map((m) => m.id));
      setReactions((list) => mergeReactions(list, (rx ?? []) as Reaction[]));
      const el = listRef.current;
      if (el) scrollRestore.current = el.scrollHeight - el.scrollTop;
      setMessages((list) => [...older, ...list]);
    }
    setMore(older.length === PAGE);
    setLoadingMore(false);
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 200) loadOlder();
  };

  // ── actions
  const failText = (message: string) =>
    cloudErrorText(message) ??
    (message.includes("only") ? `${POST_ROLE_LABEL[room.post_min_role]} can start posts in this room.` : "Message didn't send. Try again.");

  /**
   * A new message in the room shows at once (with its final id, so the realtime echo merges into it) and is saved in
   * the background. If saving fails it stays, marked, with Retry and Discard.
   */
  const deliver = async (m: Message): Promise<void> => {
    setOutgoing((o) => ({ ...o, [m.id]: "sending" }));
    const { data, error: err } = await supabase
      .from("messages")
      .insert({ id: m.id, room_id: room.id, author_id: me.id, body: m.body, parent_id: null })
      .select()
      .single();
    if (err) {
      setOutgoing((o) => ({ ...o, [m.id]: "failed" }));
      flash(failText(err.message));
      return;
    }
    setOutgoing((o) => {
      const next = { ...o };
      delete next[m.id];
      return next;
    });
    const saved = data as Message;
    // The server's clock decides the order.
    setMessages((list) => upsertMessage(list.filter((x) => x.id !== saved.id), saved));
    play("sent");
    nudgePush(saved.body, false);
    markPushMoment();
    if (BOT_MENTION.test(saved.body)) {
      fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: saved.id }) }).catch(() => {});
    }
  };

  const sendNow = async (body: string): Promise<boolean> => {
    const m: Message = {
      id: newMessageId(),
      room_id: room.id,
      community_id: community.id,
      author_id: me.id,
      parent_id: null,
      body,
      reply_count: 0,
      last_reply_at: null,
      resolved_at: null,
      resolved_by: null,
      outcome: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    };
    fresh.current.add(m.id);
    nearBottom.current = true;
    setMessages((list) => upsertMessage(list, m));
    void deliver(m);
    return true;
  };

  const discard = (id: string) => {
    setOutgoing((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
    setMessages((list) => list.filter((x) => x.id !== id));
  };

  const send = async (body: string, parentId: string | null = null, files: OutgoingAttachment[] = []): Promise<boolean> => {
    // With files: post_message links them in the same insert (0013). Without: a plain insert, as before.
    const { data, error: err } = files.length
      ? await supabase.rpc("post_message", { p_room: room.id, p_body: body, p_parent: parentId, p_attachments: files })
      : await supabase.from("messages").insert({ room_id: room.id, author_id: me.id, body, parent_id: parentId }).select().single();
    if (err) {
      flash(
        cloudErrorText(err.message) ??
          (err.message.includes("only")
            ? `${POST_ROLE_LABEL[room.post_min_role]} can start posts in this room.`
            : "Message didn't send. Try again."),
      );
      return false;
    }
    const m = data as Message;
    play("sent");
    nudgePush(m.body, Boolean(parentId));
    markPushMoment();
    nearBottom.current = true;
    // A reply in a thread the bot already answered continues the conversation (0016); the database decides.
    const botThread = Boolean(parentId) && threadReplies.some((r) => profiles[r.author_id]?.is_bot);
    if (BOT_MENTION.test(body) || botThread) {
      fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id }) }).catch(() => {});
    }
    if (parentId) {
      setThreadReplies((list) => upsertMessage(list, m));
      setMessages((list) => list.map((x) => (x.id === parentId ? { ...x, reply_count: x.reply_count + 1 } : x)));
    } else {
      setMessages((list) => upsertMessage(list, m));
    }
    return true;
  };

  const openThread = async (m: Message) => {
    setThreadRoot(m);
    setPanel("thread");
    setThreadReplies([]);
    setThreadLoading(true);
    const { data } = await supabase.from("messages").select(WITH_ATTACHMENTS).eq("parent_id", m.id).order("created_at").limit(500);
    const replies = (data ?? []) as Message[];
    ensureProfiles([...new Set(replies.map((r) => r.author_id))]);
    if (replies.length) {
      const { data: rx } = await supabase.from("reactions").select("message_id, user_id, emoji").in("message_id", replies.map((r) => r.id));
      setReactions((list) => mergeReactions(list, (rx ?? []) as Reaction[]));
    }
    if (threadRootId.current === m.id) {
      setThreadReplies(replies);
      setThreadLoading(false);
    }
  };

  const openThreadById = async (id: string) => {
    const local = messages.find((m) => m.id === id);
    if (local) return openThread(local);
    const { data } = await supabase.from("messages").select(WITH_ATTACHMENTS).eq("id", id).maybeSingle();
    if (!data) return;
    const m = data as Message;
    if (m.parent_id) {
      const { data: parent } = await supabase.from("messages").select(WITH_ATTACHMENTS).eq("id", m.parent_id).maybeSingle();
      if (parent) {
        ensureProfiles([(parent as Message).author_id]);
        openThread(parent as Message);
      }
    } else {
      ensureProfiles([m.author_id]);
      openThread(m);
    }
  };

  const actions: MessageActions = {
    report: (m) => window.open(`/report/${community.slug}?m=${m.id}`, "_blank", "noopener"),
    react: async (m, emoji) => {
      const mine = reactions.some((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
      const r = { message_id: m.id, user_id: me.id, emoji };
      if (mine) {
        setReactions((list) => list.filter((x) => !(x.message_id === m.id && x.user_id === me.id && x.emoji === emoji)));
        await supabase.from("reactions").delete().match(r);
      } else {
        setReactions((list) => mergeReactions(list, [r]));
        const { error: err } = await supabase.from("reactions").insert(r);
        if (err) setReactions((list) => list.filter((x) => !(x.message_id === m.id && x.user_id === me.id && x.emoji === emoji)));
      }
    },
    openThread,
    pin: async (m) => {
      const { error: err } = await supabase.from("board_items").insert({
        room_id: room.id,
        created_by: me.id,
        kind: "note",
        title: (m.body || m.attachments?.[0]?.name || "File").replace(/\s+/g, " ").slice(0, 140),
        body: m.body.length > 140 ? m.body.slice(0, 2000) : "",
        message_id: m.id,
      });
      if (err) return flash("Couldn't pin that.");
      setPanel("board");
      const { data } = await supabase.from("board_items").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(200);
      if (data) setBoard(data as BoardItem[]);
    },
    edit: async (m, body) => {
      const { data, error: err } = await supabase.from("messages").update({ body }).eq("id", m.id).select().single();
      if (err) {
        flash("Couldn't save the edit.");
        return false;
      }
      const updated = data as Message;
      // Adding @ctrl in an edit asks it too (0016).
      if (BOT_MENTION.test(body) && !BOT_MENTION.test(m.body)) {
        fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: updated.id }) }).catch(() => {});
      }
      if (updated.parent_id) setThreadReplies((list) => upsertMessage(list, updated));
      else setMessages((list) => upsertMessage(list, updated));
      if (threadRoot?.id === updated.id) setThreadRoot(updated);
      return true;
    },
    remove: async (m) => {
      const { error: err } = await supabase.rpc("delete_message", { p_message: m.id });
      if (err) return flash("You can't delete that message.");
      // The database already deleted the files; remove their bytes now instead of at the daily cleanup.
      purgeAttachments(m.attachments);
      const gone = { ...m, deleted_at: new Date().toISOString(), body: "", attachments: [] };
      if (m.parent_id) setThreadReplies((list) => upsertMessage(list, gone));
      else setMessages((list) => upsertMessage(list, gone));
      if (threadRoot?.id === m.id) setThreadRoot(gone);
    },
  };

  // Stable handles for the memoized message rows: they always call the latest closures above.
  const live = useRef({ actions, deliver, discard });
  live.current = { actions, deliver, discard };
  const rowActions = useMemo<MessageActions>(
    () => ({
      report: (m) => live.current.actions.report?.(m),
      react: (m, emoji) => live.current.actions.react(m, emoji),
      openThread: (m) => live.current.actions.openThread?.(m),
      pin: (m) => live.current.actions.pin?.(m),
      edit: (m, body) => live.current.actions.edit(m, body),
      remove: (m) => live.current.actions.remove(m),
    }),
    [],
  );
  const retry = useCallback((m: Message) => void live.current.deliver(m), []);
  const drop = useCallback((id: string) => live.current.discard(id), []);

  const onTogglePin = async () => {
    const err = await togglePin(room.id);
    if (err) flash(err);
  };

  const setNotify = async (level: Unread["notify"]) => {
    setUnreads((u) => ({ ...u, [room.id]: { ...(u[room.id] ?? { room_id: room.id, unread: 0, mentions: 0 }), notify: level } }));
    await supabase.rpc("set_room_notify", { p_room: room.id, p_notify: level });
  };

  const typingNames = Object.values(typing).map((t) => t.name);
  const agentStatus = agentLine(Object.values(agents));
  const threadAgentStatus = threadRoot ? agentLine(Object.values(agents).filter((j) => j.thread_id === threadRoot.id)) : null;

  return (
    <div className="cr-room-in flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="cr-chrome flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
          <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <RoomIcon room={room} className="h-4 w-4 shrink-0 text-muted" />
          <h1 className="min-w-0 truncate font-semibold">
            <button
              className="max-w-full truncate rounded hover:underline focus-visible:underline"
              onClick={() => setPanel(panel === "info" ? null : "info")}
              title="Room info"
              aria-expanded={panel === "info"}
            >
              {room.name}
            </button>
          </h1>
          {room.topic && (
            <button
              className="hidden min-w-0 truncate border-l border-line pl-3 text-left text-sm text-muted hover:text-fg lg:block"
              onClick={() => setPanel("info")}
              title={room.description ? `${room.topic}

${room.description}` : room.topic}
              aria-label={`Topic: ${room.topic}. Show room info`}
            >
              {room.topic}
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center">
            <span className="hidden items-center sm:flex">
              <HeaderButton label={pinned ? "Unpin room" : "Pin room"} active={pinned} onClick={onTogglePin}>
                <PinIcon />
              </HeaderButton>
              <HeaderButton label="Room info" active={panel === "info"} onClick={() => setPanel(panel === "info" ? null : "info")}>
                <InfoIcon />
              </HeaderButton>
              {canEdit && (
                <HeaderButton label="Edit room" onClick={() => setEditing(true)}>
                  <SettingsIcon />
                </HeaderButton>
              )}
            </span>
            <HeaderButton label={callOpen ? "Hide call" : "Start or join a call"} active={callOpen} onClick={() => setCallOpen((v) => !v)}>
              <PhoneIcon />
            </HeaderButton>
            <HeaderButton label="Room board" active={panel === "board"} onClick={() => setPanel(panel === "board" ? null : "board")}>
              <BoardIcon />
              {board.length > 0 && <span className="ml-1 text-xs">{board.length}</span>}
            </HeaderButton>
            <HeaderButton label="Search" active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
              <SearchIcon />
            </HeaderButton>
            <HeaderButton label="People" active={panel === "members"} onClick={() => setPanel(panel === "members" ? null : "members")}>
              <UsersIcon />
            </HeaderButton>
            {/* Phones: just the bell (the picker opens on a tap), so the room's name has room in the header. */}
            <label className="relative ml-1 flex items-center gap-1 rounded p-1.5 text-muted hover:bg-raised sm:px-1.5 sm:py-1" title="Notifications for this room">
              {notify === "none" ? <BellOffIcon /> : <BellIcon />}
              <select
                className="absolute inset-0 cursor-pointer bg-transparent text-xs opacity-0 focus:outline-none sm:static sm:opacity-100"
                value={notify}
                onChange={(e) => setNotify(e.target.value as Unread["notify"])}
                aria-label="Notifications for this room"
              >
                <option value="mentions">Mentions</option>
                <option value="all">Everything</option>
                <option value="none">Muted</option>
              </select>
            </label>
          </div>
        </header>

        {ringing && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-b border-line bg-signal/10 px-4 py-2.5 text-sm">
            <HeadsetIcon className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              <span className="font-medium">{profiles[ringing.by]?.display_name ?? "Someone"}</span> started a call in #{room.name}
            </p>
            <div className="flex gap-2">
              {livekit && (
                <button
                  className="btn-primary py-1 text-xs"
                  onClick={() => {
                    presence?.dismissIncoming();
                    setCallOpen(true);
                    setJoinNow((n) => n + 1);
                  }}
                >
                  Join voice
                </button>
              )}
              <button className="btn-outline py-1 text-xs" onClick={() => presence?.dismissIncoming()}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {callOpen && <CallPanel roomId={room.id} roomName={room.name} enabled={livekit} joinNow={joinNow} />}

        {catchUp && (
          <CatchUpBanner
            data={catchUp}
            onDismiss={() => setCatchUp(null)}
            onBoard={() => setPanel("board")}
            onThread={(id) => openThreadById(id)}
            onJump={() => {
              const id = catchUp.first_unread_id;
              if (!id) return;
              const el = document.getElementById(`m-${id}`);
              if (el) {
                el.scrollIntoView({ block: "start", behavior: "smooth" });
                setHighlight(id);
                setTimeout(() => setHighlight(null), 2500);
              } else {
                openThreadById(id);
              }
            }}
          />
        )}

        <div ref={listRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite">
          {more ? (
            <div className="py-4 text-center">
              <button className="text-xs text-muted hover:text-fg" onClick={loadOlder} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load older messages"}
              </button>
            </div>
          ) : (
            <div className="px-4 pb-4 pt-10">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-raised">
                <RoomIcon room={room} className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-semibold">Welcome to #{room.name}</h2>
              <p className="mt-1 text-sm text-muted">{room.topic || "This is the start of the room."}</p>
            </div>
          )}
          <MessageList
            rows={rows}
            profiles={profiles}
            summary={summary}
            me={me}
            canModerate={canModerate}
            highlight={highlight}
            outgoing={outgoing}
            fresh={fresh.current}
            actions={rowActions}
            onRetry={retry}
            onDiscard={drop}
          />
        </div>

        <div className="h-5 truncate px-5 text-xs text-muted" aria-live="polite">
          {agentStatus ? (
            <span className="inline-flex items-center gap-1.5 text-fg">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
              {agentStatus}
            </span>
          ) : typingNames.length > 0 &&
            (typingNames.length === 1
              ? `${typingNames[0]} is typing…`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                : "Several people are typing…")}
        </div>
        {error && <p className="px-5 pb-1 text-xs text-alert" role="alert">{error}</p>}
        <Composer
          placeholder={`Message #${room.name} · @ctrl for AI help`}
          communityId={community.id}
          disabled={!canPost}
          disabledReason={`${POST_ROLE_LABEL[room.post_min_role]} can start posts here. You can still reply in threads.`}
          // Text goes out optimistically (sendNow); with files it waits for the upload path (post_message, 0013).
          onSend={(body, files) => (files.length ? send(body, null, files) : sendNow(body))}
          attach={{ kind: "room", roomId: room.id }}
          onTyping={sendTyping}
        />
      </section>

      {panel === "thread" && threadRoot && (
        <ThreadPanel
          root={threadRoot}
          replies={threadReplies}
          reactions={reactions}
          loading={threadLoading}
          actions={rowActions}
          onClose={() => {
            setPanel(null);
            setThreadRoot(null);
          }}
          onReply={(body, files) => send(body, threadRoot.id, files)}
          agentStatus={threadAgentStatus}
          onResolve={async (outcome, pin) => {
            const { error: err } = await supabase.rpc("resolve_thread", { p_message: threadRoot.id, p_outcome: outcome, p_pin: pin });
            if (err) {
              flash("Couldn't close the thread.");
              return false;
            }
            const closed = { ...threadRoot, outcome: outcome.trim(), resolved_at: new Date().toISOString(), resolved_by: me.id };
            setThreadRoot(closed);
            setMessages((list) => (list.some((x) => x.id === closed.id) ? upsertMessage(list, closed) : list));
            return true;
          }}
          onReopen={async () => {
            const { error: err } = await supabase.rpc("reopen_thread", { p_message: threadRoot.id });
            if (err) return flash("Couldn't reopen the thread.");
            const open = { ...threadRoot, outcome: null, resolved_at: null, resolved_by: null };
            setThreadRoot(open);
            setMessages((list) => (list.some((x) => x.id === open.id) ? upsertMessage(list, open) : list));
          }}
        />
      )}
      {panel === "board" && (
        <BoardPanel
          roomName={room.name}
          items={board}
          onClose={() => setPanel(null)}
          onJump={(id) => {
            const el = document.getElementById(`m-${id}`);
            if (el) {
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              setHighlight(id);
              setTimeout(() => setHighlight(null), 2500);
            } else {
              openThreadById(id);
            }
          }}
          onAdd={async (item) => {
            const { data, error: err } = await supabase
              .from("board_items")
              .insert({ ...item, room_id: room.id, created_by: me.id })
              .select()
              .single();
            if (err) {
              flash("Couldn't add that to the board.");
              return false;
            }
            setBoard((list) => [data as BoardItem, ...list.filter((i) => i.id !== (data as BoardItem).id)]);
            return true;
          }}
          onDelete={async (item) => {
            const { error: err } = await supabase.from("board_items").delete().eq("id", item.id);
            if (err) return flash("Couldn't remove that.");
            setBoard((list) => list.filter((i) => i.id !== item.id));
          }}
        />
      )}
      {panel === "info" && (
        <Panel title={`About #${room.name}`} onClose={() => setPanel(null)}>
          <div className="space-y-5 p-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised">
                <RoomIcon room={room} className="h-5 w-5" />
              </span>
              <p className="min-w-0 font-medium">{room.topic || room.name}</p>
            </div>
            {room.description ? (
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                <LinkedText text={room.description} />
              </p>
            ) : (
              <p className="text-muted">{canEdit ? "No description yet. Add one with Edit room." : "No description yet."}</p>
            )}
            {inCall.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <HeadsetIcon className="h-3.5 w-3.5" /> In the call · {inCall.length}
                </h3>
                <ul className="space-y-2">
                  {inCall.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <PresenceAvatar profile={profiles[id]} size={28} />
                      <span className="min-w-0 truncate">{profiles[id]?.display_name ?? "…"}</span>
                      {presence?.peers[id]?.call?.video && <span className="text-xs text-muted">Video</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Type</dt>
              <dd>{room.kind === "voice" ? "Voice" : "Text"}</dd>
              <dt className="text-muted">Who can start posts</dt>
              <dd>{POST_ROLE_LABEL[room.post_min_role]}</dd>
              <dt className="text-muted">Link</dt>
              <dd className="break-all">
                /c/{community.slug}/{room.slug}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <button className="btn-outline" onClick={onTogglePin} aria-pressed={pinned}>
                <PinIcon /> {pinned ? "Unpin" : "Pin to top"}
              </button>
              {canEdit && (
                <button className="btn-outline" onClick={() => setEditing(true)}>
                  <SettingsIcon /> Edit room
                </button>
              )}
            </div>
            <p className="text-xs text-muted">Pins are just for you.</p>
          </div>
        </Panel>
      )}
      {panel === "search" && <SearchPanel onClose={() => setPanel(null)} />}
      {editing && <RoomEditDialog room={room} onClose={() => setEditing(false)} />}
      {panel === "members" && <MembersPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

/**
 * The room's messages. Memoized, and so is each row: typing, presence, the composer and the panels re-render the room
 * but not this; a new message or a reaction re-renders only the rows it touches.
 */
const MessageList = memo(function MessageList({
  rows,
  profiles,
  summary,
  me,
  canModerate,
  highlight,
  outgoing,
  fresh,
  actions,
  onRetry,
  onDiscard,
}: {
  rows: Row[];
  profiles: Record<string, Profile>;
  summary: Map<string, ReactionSummary[]>;
  me: Profile;
  canModerate: boolean;
  highlight: string | null;
  outgoing: Record<string, "sending" | "failed">;
  fresh: Set<string>;
  actions: MessageActions;
  onRetry: (m: Message) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <>
      {rows.map(({ message, compact, day }) => (
        <MessageRow
          key={message.id}
          message={message}
          day={day}
          compact={compact && !day}
          author={profiles[message.author_id]}
          reactions={summary.get(message.id)}
          me={me}
          canModerate={canModerate}
          highlight={highlight === message.id}
          state={outgoing[message.id]}
          fresh={fresh.has(message.id)}
          actions={actions}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />
      ))}
    </>
  );
});

const MessageRow = memo(function MessageRow({
  message,
  day,
  compact,
  author,
  reactions,
  me,
  canModerate,
  highlight,
  state,
  fresh,
  actions,
  onRetry,
  onDiscard,
}: {
  message: Message;
  day: string | null;
  compact: boolean;
  author: Profile | undefined;
  reactions: ReactionSummary[] | undefined;
  me: Profile;
  canModerate: boolean;
  highlight: boolean;
  state: "sending" | "failed" | undefined;
  fresh: boolean;
  actions: MessageActions;
  onRetry: (m: Message) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <div className={`${fresh ? "cr-msg-in" : ""} ${state === "sending" ? "opacity-60" : ""}`}>
      {day && (
        <div className="my-3 flex items-center gap-3 px-4 text-xs font-medium text-muted">
          <span className="h-px flex-1 bg-line" />
          {day}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      <MessageItem message={message} author={author} compact={compact} reactions={reactions} me={me} canModerate={canModerate} highlight={highlight} actions={actions} />
      {state === "failed" && (
        <div className="flex items-center gap-2 pb-1 pl-16 pr-4 text-xs" role="alert">
          <span className="text-alert">Didn&apos;t send.</span>
          <button className="rounded-full border border-line px-2.5 py-1 font-medium hover:bg-raised" onClick={() => onRetry(message)}>
            Retry
          </button>
          <button className="rounded-full px-2 py-1 text-muted hover:text-fg" onClick={() => onDiscard(message.id)}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
});

function HeaderButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`flex items-center rounded p-1.5 ${active ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

