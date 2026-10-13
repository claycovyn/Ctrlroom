"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConfirm, usePrompt } from "@/components/Dialogs";
import { Composer } from "@/components/chat/Composer";
import { ArrowLeftIcon, BellIcon, BellOffIcon, MoreIcon, UsersIcon } from "@/components/chat/icons";
import { MessageItem, type MessageActions } from "@/components/chat/MessageItem";
import { Panel } from "@/components/chat/Panel";
import { PresenceAvatar } from "@/components/chat/PresenceAvatar";
import { cloudErrorText } from "@/lib/cloudErrors";
import { asRoomMessage, conversationName, MAX_GROUP, otherMembers, requestState, upsertDm, type DmMember, type DmMessage, type DmReaction } from "@/lib/dms";
import { buildRows, summarizeReactions } from "@/lib/format";
import { play } from "@/lib/sounds";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Message, Profile } from "@/lib/types";
import { useDm } from "./DmContext";
import { ConversationAvatar } from "./DmInbox";
import { NewMessageDialog } from "./NewMessageDialog";
import { ReportDmDialog } from "./ReportDmDialog";

const PAGE = 50;

const toProfile = (m: DmMember): Profile => ({ id: m.user_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url });

export function DmConversationView({ id }: { id: string }) {
  const { me, base, conversations, loaded, refresh, refreshBlocks, setConversations, blocked, viewing, subscribe, markConversationRead } = useDm();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();
  const supabase = supabaseBrowser();
  const conv = conversations.find((c) => c.id === id) ?? null;

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [reactions, setReactions] = useState<DmReaction[]>([]);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [first, setFirst] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ id: string; author: string; preview: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState(false);
  const [refetched, setRefetched] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const scrollRestore = useRef<number | null>(null);

  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  // A conversation that isn't in the inbox yet (just started, or someone just added you): fetch it once.
  useEffect(() => {
    if (loaded && !conv && !refetched) {
      setRefetched(true);
      refresh();
    }
  }, [loaded, conv, refetched, refresh]);

  // ── load, mark read, keep marked read while open
  useEffect(() => {
    viewing.current = id;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("dm_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: false }).limit(PAGE);
      if (cancelled) return;
      const list = ((data ?? []) as DmMessage[]).reverse();
      setMessages(list);
      setMore(list.length === PAGE);
      setFirst(false);
      if (list.length) {
        const { data: rx } = await supabase.from("dm_reactions").select("message_id, user_id, emoji").in("message_id", list.map((m) => m.id));
        if (!cancelled) setReactions((rx ?? []) as DmReaction[]);
      }
    })();
    markConversationRead(id);
    return () => {
      cancelled = true;
      if (viewing.current === id) viewing.current = null;
      supabase.rpc("mark_dm_read", { p_conv: id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "message" && e.message.conversation_id === id) setMessages((list) => upsertDm(list, e.message));
        else if (e.type === "update" && e.message.conversation_id === id) {
          setMessages((list) => (list.some((m) => m.id === e.message.id) ? upsertDm(list, e.message) : list));
          if (e.message.deleted_at) setReactions((list) => list.filter((r) => r.message_id !== e.message.id));
        } else if (e.type === "reaction" && e.conversation_id === id) {
          const r = e.reaction;
          setReactions((list) => {
            const rest = list.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji));
            return e.op === "add" ? [...rest, r] : rest;
          });
        }
      }),
    [id, subscribe],
  );

  // ── scrolling (as in rooms)
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

  const loadOlder = async () => {
    if (!more || loadingMore || !messages.length) return;
    setLoadingMore(true);
    const { data } = await supabase
      .from("dm_messages")
      .select("*")
      .eq("conversation_id", id)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const older = ((data ?? []) as DmMessage[]).reverse();
    if (older.length) {
      const { data: rx } = await supabase.from("dm_reactions").select("message_id, user_id, emoji").in("message_id", older.map((m) => m.id));
      setReactions((list) => [...list, ...((rx ?? []) as DmReaction[])]);
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

  const profiles = useMemo(() => {
    const map: Record<string, Profile> = { [me.id]: me };
    conv?.members.forEach((m) => (map[m.user_id] = toProfile(m)));
    return map;
  }, [conv, me]);
  const rows = useMemo(() => buildRows(messages.map(asRoomMessage)), [messages]);
  const summary = useMemo(() => summarizeReactions(reactions, me.id), [reactions, me.id]);

  if (!conv) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <DmHeader title={loaded && refetched ? "Conversation" : "Loading…"} back={base} />
        {loaded && refetched && (
          <div className="p-6 text-sm text-muted">
            <p>This conversation isn&apos;t in your messages. You may have left it, or blocked the person.</p>
            <Link href={base} className="btn-outline mt-4 inline-flex">
              Back to messages
            </Link>
          </div>
        )}
      </section>
    );
  }

  const name = conversationName(conv, me.id);
  const others = otherMembers(conv, me.id);
  const other = !conv.is_group ? others[0] : undefined;
  const state = requestState(conv);
  const adder = conv.members.find((m) => m.user_id === conv.created_by);
  const latestFrom = (userId: string) => [...messages].reverse().find((m) => m.author_id === userId && !m.deleted_at);

  // ── actions
  const reload = async () => {
    await refresh();
    router.refresh();
  };

  const send = async (body: string): Promise<boolean> => {
    const { data, error: err } = await supabase.from("dm_messages").insert({ conversation_id: id, author_id: me.id, body }).select().single();
    if (err) {
      flash(cloudErrorText(err.message) ?? "Message didn't send. Try again.");
      return false;
    }
    play("sent");
    nearBottom.current = true;
    setMessages((list) => upsertDm(list, data as DmMessage));
    return true;
  };

  const block = async (person: Profile) => {
    const ok = await confirmDialog({
      title: `Block ${person.display_name}?`,
      body: conv.is_group
        ? "They can't message you or start conversations with you, and you won't see their messages here. They aren't told."
        : "They can't message you or start conversations with you, and this conversation leaves your messages. They aren't told. You can unblock them in Settings.",
      confirmLabel: "Block",
      tone: "danger",
    });
    if (!ok) return;
    const { error: err } = await supabase.rpc("block_user", { p_user: person.id });
    if (err) return flash(cloudErrorText(err.message) ?? "Couldn't block them. Try again.");
    await refreshBlocks();
    await refresh();
    if (!conv.is_group) router.push(base);
  };

  const report = (person: Profile, m: DmMessage | undefined) => {
    if (!m) return flash(`${person.display_name} has no messages here to report.`);
    setReporting({ id: m.id, author: person.display_name, preview: m.body });
  };

  const actions: MessageActions = {
    react: async (m, emoji) => {
      if (state !== "chat") return;
      const mine = reactions.some((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
      const r = { message_id: m.id, user_id: me.id, emoji };
      const drop = (list: DmReaction[]) => list.filter((x) => !(x.message_id === m.id && x.user_id === me.id && x.emoji === emoji));
      if (mine) {
        setReactions(drop);
        await supabase.from("dm_reactions").delete().match(r);
      } else {
        setReactions((list) => [...drop(list), r]);
        const { error: err } = await supabase.from("dm_reactions").insert(r);
        if (err) setReactions(drop);
      }
    },
    edit: async (m, body) => {
      const { data, error: err } = await supabase.from("dm_messages").update({ body }).eq("id", m.id).select().single();
      if (err) {
        flash("Couldn't save the edit.");
        return false;
      }
      setMessages((list) => upsertDm(list, data as DmMessage));
      return true;
    },
    remove: async (m) => {
      const { error: err } = await supabase.rpc("delete_dm_message", { p_message: m.id });
      if (err) return flash("You can't delete that message.");
      setMessages((list) => upsertDm(list, { ...(messages.find((x) => x.id === m.id) as DmMessage), body: "", deleted_at: new Date().toISOString() }));
      setReactions((list) => list.filter((r) => r.message_id !== m.id));
    },
    report: (m: Message) => {
      const author = profiles[m.author_id];
      if (author) setReporting({ id: m.id, author: author.display_name, preview: m.body });
    },
    block: (m: Message) => {
      const author = profiles[m.author_id];
      if (author) block(author);
    },
  };

  const accept = async () => {
    const { error: err } = await supabase.rpc("accept_dm_request", { p_conv: id });
    if (err) return flash(cloudErrorText(err.message) ?? "Couldn't accept. Try again.");
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, status: "active", ignored: false } : c)));
    reload();
  };
  const ignore = async () => {
    const { error: err } = await supabase.rpc("ignore_dm_request", { p_conv: id });
    if (err) return flash(cloudErrorText(err.message) ?? "Couldn't ignore it. Try again.");
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, ignored: true } : c)));
    router.push(base);
  };
  const toggleMute = async () => {
    const next = !conv.muted;
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, muted: next } : c)));
    const { error: err } = await supabase.rpc("set_dm_muted", { p_conv: id, p_muted: next });
    if (err) {
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, muted: !next } : c)));
      flash("Couldn't change that. Try again.");
    }
  };
  const rename = async () => {
    const title = await promptDialog({
      title: "Name this group",
      label: "Group name",
      defaultValue: conv.title ?? "",
      maxLength: 64,
      hint: "Everyone in the group sees it. Leave it empty to show people's names.",
      confirmLabel: "Save",
    });
    if (title === null) return;
    const { error: err } = await supabase.rpc("rename_dm_group", { p_conv: id, p_title: title });
    if (err) return flash(cloudErrorText(err.message) ?? "Couldn't rename the group.");
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: title.trim() || null } : c)));
  };
  const leave = async () => {
    const ok = await confirmDialog({
      title: `Leave ${name}?`,
      body: "You won't get new messages from this group. Someone in it can add you back.",
      confirmLabel: "Leave",
      tone: "danger",
    });
    if (!ok) return;
    const { error: err } = await supabase.rpc("leave_dm", { p_conv: id });
    if (err) return flash(cloudErrorText(err.message) ?? "Couldn't leave. Try again.");
    await refresh();
    router.push(base);
  };

  const closeMenu = (e: React.MouseEvent) => e.currentTarget.closest("details")?.removeAttribute("open");
  const room = MAX_GROUP - conv.members.filter((m) => m.status !== "left").length;

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <DmHeader back={base} title={name} avatar={<ConversationAvatar c={conv} meId={me.id} size={28} />} subtitle={conv.is_group ? `${others.length + 1} people` : other ? `@${other.username}` : undefined}>
          {conv.is_group && (
            <button className={`rounded p-1.5 hover:bg-raised ${people ? "text-fg" : "text-muted hover:text-fg"}`} onClick={() => setPeople((v) => !v)} aria-label="People" aria-expanded={people} title="People">
              <UsersIcon />
            </button>
          )}
          <button className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg" onClick={toggleMute} aria-pressed={conv.muted} aria-label={conv.muted ? "Unmute" : "Mute"} title={conv.muted ? "Muted: no sounds or alerts. Unmute" : "Mute"}>
            {conv.muted ? <BellOffIcon /> : <BellIcon />}
          </button>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center rounded p-1.5 text-muted hover:bg-raised hover:text-fg [&::-webkit-details-marker]:hidden" aria-label="Conversation options" title="More">
              <MoreIcon />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
              {conv.is_group && state === "chat" && (
                <>
                  <MenuButton onClick={(e) => (closeMenu(e), rename())}>Rename group</MenuButton>
                  <MenuButton onClick={(e) => (closeMenu(e), setAdding(true))} disabled={room <= 0}>
                    {room <= 0 ? "Group is full" : "Add people"}
                  </MenuButton>
                </>
              )}
              <MenuButton onClick={(e) => (closeMenu(e), toggleMute())}>{conv.muted ? "Unmute" : "Mute"}</MenuButton>
              {other && (
                <>
                  <MenuButton onClick={(e) => (closeMenu(e), report(toProfile(other), latestFrom(other.user_id)))}>Report {other.display_name}</MenuButton>
                  <MenuButton danger onClick={(e) => (closeMenu(e), block(toProfile(other)))}>
                    Block {other.display_name}
                  </MenuButton>
                </>
              )}
              {conv.is_group && (
                <MenuButton danger onClick={(e) => (closeMenu(e), leave())}>
                  Leave group
                </MenuButton>
              )}
            </div>
          </details>
        </DmHeader>

        {state !== "chat" && (
          <div role="region" aria-label="Message request" className="flex flex-wrap items-center gap-3 border-b border-line bg-raised/60 px-4 py-3 text-sm">
            <p className="min-w-0 flex-1">
              {state === "ignored"
                ? "You ignored this request. It won't notify you."
                : conv.is_group
                  ? `${adder?.display_name ?? "Someone"} added you to this group. Accept to reply.`
                  : `${other?.display_name ?? "Someone"} wants to message you. Accept to reply.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary py-1 text-xs" onClick={accept}>
                Accept
              </button>
              {state === "request" && (
                <button className="btn-outline py-1 text-xs" onClick={ignore}>
                  Ignore
                </button>
              )}
              {(other || adder) && (other ?? adder)!.user_id !== me.id && (
                <button className="btn-ghost py-1 text-xs text-alert" onClick={() => block(toProfile((other ?? adder)!))}>
                  Block
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="border-b border-line bg-alert/15 px-4 py-2 text-sm">
            {error}
          </p>
        )}

        <div ref={listRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite">
          {more ? (
            <div className="py-4 text-center">
              <button className="text-xs text-muted hover:text-fg" onClick={loadOlder} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load older messages"}
              </button>
            </div>
          ) : (
            !first && (
              <div className="px-4 pb-4 pt-10">
                <ConversationAvatar c={conv} meId={me.id} size={48} />
                <h2 className="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {conv.is_group ? "This is the start of the group." : `This is the start of your conversation with ${other?.display_name ?? "them"}.`} Only the people
                  in it can read it.
                </p>
              </div>
            )
          )}
          {rows.map(({ message, compact, day }) => (
            <div key={message.id}>
              {day && (
                <div className="my-3 flex items-center gap-3 px-4 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {day}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {blocked.has(message.author_id) && message.author_id !== me.id ? (
                <p className="px-4 py-1 pl-[60px] text-sm italic text-muted">Message from someone you blocked</p>
              ) : (
                <MessageItem
                  message={message}
                  author={profiles[message.author_id]}
                  compact={compact && !day}
                  reactions={summary.get(message.id)}
                  me={me}
                  canModerate={false}
                  actions={state === "chat" ? actions : { ...actions, react: () => {} }}
                />
              )}
            </div>
          ))}
        </div>

        <Composer
          placeholder={`Message ${conv.is_group ? name : (other?.display_name ?? "")}`.trim()}
          communityId={null}
          disabled={state !== "chat"}
          disabledReason="Accept the request to reply."
          onSend={send}
          autoFocus={state === "chat"}
        />
      </section>

      {people && conv.is_group && (
        <Panel title={`People · ${others.length + 1}`} onClose={() => setPeople(false)}>
          <ul className="p-2">
            {conv.members
              .filter((m) => m.status !== "left")
              .map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-raised">
                  <PresenceAvatar profile={toProfile(m)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.display_name}
                      {m.user_id === me.id && <span className="text-muted"> (you)</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      @{m.username}
                      {m.status === "request" && " · Invited"}
                      {blocked.has(m.user_id) && " · Blocked"}
                    </span>
                  </span>
                  {m.user_id !== me.id && (
                    <details className="relative">
                      <summary
                        className="flex cursor-pointer list-none items-center rounded p-1 text-muted hover:bg-line hover:text-fg [&::-webkit-details-marker]:hidden"
                        aria-label={`Options for ${m.display_name}`}
                      >
                        <MoreIcon />
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
                        <MenuButton onClick={(e) => (closeMenu(e), report(toProfile(m), latestFrom(m.user_id)))}>Report</MenuButton>
                        {!blocked.has(m.user_id) && (
                          <MenuButton danger onClick={(e) => (closeMenu(e), block(toProfile(m)))}>
                            Block
                          </MenuButton>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {reporting && <ReportDmDialog messageId={reporting.id} author={reporting.author} preview={reporting.preview} onClose={() => setReporting(null)} />}
      {adding && (
        <NewMessageDialog
          onClose={() => setAdding(false)}
          addTo={{ conversationId: id, memberIds: conv.members.filter((m) => m.status !== "left").map((m) => m.user_id), room, onAdded: reload }}
        />
      )}
    </div>
  );
}

function MenuButton({ onClick, children, danger = false, disabled = false }: { onClick: (e: React.MouseEvent) => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button className={`block w-full px-3 py-1.5 text-left hover:bg-raised disabled:opacity-50 ${danger ? "text-alert" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function DmHeader({
  title,
  subtitle,
  avatar,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  avatar?: React.ReactNode;
  back: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-4">
      <Link href={back} className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg lg:hidden" aria-label="Back to messages" title="Back to messages">
        <ArrowLeftIcon className="h-5 w-5" />
      </Link>
      {avatar}
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="truncate font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </header>
  );
}
