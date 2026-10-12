"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildRows, summarizeReactions, upsertMessage } from "@/lib/format";
import { useBroadcast } from "@/lib/realtime";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type BoardItem, type CatchUp, type Message, type Profile, type Reaction, type Room, type Unread } from "@/lib/types";
import { BoardPanel } from "./BoardPanel";
import { CatchUpBanner } from "./CatchUpBanner";
import { useCommunity } from "./CommunityContext";
import { Composer } from "./Composer";
import { BellIcon, BellOffIcon, BoardIcon, HashIcon, MegaphoneIcon, MenuIcon, PhoneIcon, SearchIcon, UsersIcon, VoiceIcon } from "./icons";
import { MembersPanel } from "./MembersPanel";
import { MessageItem, type MessageActions } from "./MessageItem";
import { SearchPanel } from "./SearchPanel";
import { ThreadPanel } from "./ThreadPanel";

const CallPanel = dynamic(() => import("./CallPanel"), { ssr: false });

const PAGE = 50;
type PanelKind = "thread" | "board" | "search" | "members" | null;

function mergeReactions(list: Reaction[], add: Reaction[]): Reaction[] {
  const key = (r: Reaction) => `${r.message_id}|${r.user_id}|${r.emoji}`;
  const seen = new Set(list.map(key));
  return [...list, ...add.filter((r) => !seen.has(key(r)))];
}

export function RoomView({
  room,
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
  const { me, role, community, profiles, ensureProfiles, addProfiles, currentRoomId, unreads, setUnreads, setNavOpen, livekit } = useCommunity();
  const supabase = supabaseBrowser();

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
  const [callOpen, setCallOpen] = useState(room.kind === "voice");
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(focusMessageId);

  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const scrollRestore = useRef<number | null>(null);
  const threadRootId = useRef<string | null>(null);
  threadRootId.current = threadRoot?.id ?? null;

  const notify = unreads[room.id]?.notify ?? "mentions";
  const canPost = atLeast(role, room.post_min_role);
  const canModerate = atLeast(role, "mod");
  const summary = useMemo(() => summarizeReactions(reactions, me.id), [reactions, me.id]);
  const rows = useMemo(() => buildRows(messages), [messages]);

  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

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
      .select("*")
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
  const send = async (body: string, parentId: string | null = null): Promise<boolean> => {
    const { data, error: err } = await supabase
      .from("messages")
      .insert({ room_id: room.id, author_id: me.id, body, parent_id: parentId })
      .select()
      .single();
    if (err) {
      flash(err.message.includes("only") ? "Only mods can start posts in this room." : "Message didn't send. Try again.");
      return false;
    }
    const m = data as Message;
    nearBottom.current = true;
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
    const { data } = await supabase.from("messages").select("*").eq("parent_id", m.id).order("created_at").limit(500);
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
    const { data } = await supabase.from("messages").select("*").eq("id", id).maybeSingle();
    if (!data) return;
    const m = data as Message;
    if (m.parent_id) {
      const { data: parent } = await supabase.from("messages").select("*").eq("id", m.parent_id).maybeSingle();
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
        title: m.body.replace(/\s+/g, " ").slice(0, 140),
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
      if (updated.parent_id) setThreadReplies((list) => upsertMessage(list, updated));
      else setMessages((list) => upsertMessage(list, updated));
      if (threadRoot?.id === updated.id) setThreadRoot(updated);
      return true;
    },
    remove: async (m) => {
      const { error: err } = await supabase.rpc("delete_message", { p_message: m.id });
      if (err) return flash("You can't delete that message.");
      const gone = { ...m, deleted_at: new Date().toISOString(), body: "" };
      if (m.parent_id) setThreadReplies((list) => upsertMessage(list, gone));
      else setMessages((list) => upsertMessage(list, gone));
      if (threadRoot?.id === m.id) setThreadRoot(gone);
    },
  };

  const setNotify = async (level: Unread["notify"]) => {
    setUnreads((u) => ({ ...u, [room.id]: { ...(u[room.id] ?? { room_id: room.id, unread: 0, mentions: 0 }), notify: level } }));
    await supabase.rpc("set_room_notify", { p_room: room.id, p_notify: level });
  };

  const typingNames = Object.values(typing).map((t) => t.name);
  const RoomIcon = room.kind === "voice" ? VoiceIcon : room.post_min_role !== "member" ? MegaphoneIcon : HashIcon;

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
          <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <RoomIcon className="h-4 w-4 shrink-0 text-muted" />
          <h1 className="truncate font-semibold">{room.name}</h1>
          {room.topic && <p className="hidden truncate border-l border-line pl-3 text-sm text-muted lg:block">{room.topic}</p>}
          <div className="ml-auto flex shrink-0 items-center">
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
            <label className="ml-1 flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-raised" title="Notifications for this room">
              {notify === "none" ? <BellOffIcon /> : <BellIcon />}
              <select
                className="cursor-pointer bg-transparent text-xs focus:outline-none"
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

        {callOpen && <CallPanel roomId={room.id} roomName={room.name} enabled={livekit} />}

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
                <RoomIcon className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-semibold">Welcome to #{room.name}</h2>
              <p className="mt-1 text-sm text-muted">{room.topic || "This is the start of the room."}</p>
            </div>
          )}
          {rows.map(({ message, compact, day }) => (
            <div key={message.id}>
              {day && (
                <div className="my-3 flex items-center gap-3 px-4 text-xs font-medium text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {day}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <MessageItem
                message={message}
                author={profiles[message.author_id]}
                compact={compact && !day}
                reactions={summary.get(message.id)}
                me={me}
                canModerate={canModerate}
                highlight={highlight === message.id}
                actions={actions}
              />
            </div>
          ))}
        </div>

        <div className="h-5 px-5 text-xs text-muted" aria-live="polite">
          {typingNames.length > 0 &&
            (typingNames.length === 1
              ? `${typingNames[0]} is typing…`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                : "Several people are typing…")}
        </div>
        {error && <p className="px-5 pb-1 text-xs text-alert" role="alert">{error}</p>}
        <Composer
          placeholder={`Message #${room.name}`}
          communityId={community.id}
          disabled={!canPost}
          disabledReason="Only mods post here. You can still reply in threads."
          onSend={(body) => send(body)}
          onTyping={sendTyping}
        />
      </section>

      {panel === "thread" && threadRoot && (
        <ThreadPanel
          root={threadRoot}
          replies={threadReplies}
          reactions={reactions}
          loading={threadLoading}
          actions={actions}
          onClose={() => {
            setPanel(null);
            setThreadRoot(null);
          }}
          onReply={(body) => send(body, threadRoot.id)}
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
      {panel === "search" && <SearchPanel onClose={() => setPanel(null)} />}
      {panel === "members" && <MembersPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

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

