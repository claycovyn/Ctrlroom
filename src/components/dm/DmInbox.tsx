"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { useOptionalCommunity } from "@/components/chat/CommunityContext";
import { BellOffIcon, MenuIcon, PlusIcon, UsersIcon } from "@/components/chat/icons";
import { PresenceAvatar } from "@/components/chat/PresenceAvatar";
import { conversationName, otherMembers, previewText, requestState, splitInbox, type DmConversation, type InboxTab } from "@/lib/dms";
import { sinceLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useDm } from "./DmContext";
import { NewMessageDialog } from "./NewMessageDialog";

/** One face for a 1:1 (with their status when you share the open community), two overlapping for a group. */
export function ConversationAvatar({ c, meId, size = 36 }: { c: DmConversation; meId: string; size?: number }) {
  const others = otherMembers(c, meId);
  const asProfile = (m: (typeof others)[number]): Profile => ({ id: m.user_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url });
  if (!c.is_group) return <PresenceAvatar profile={others[0] ? asProfile(others[0]) : undefined} size={size} />;
  // Small sizes: one tile with a people icon (two faces would be too small to read).
  if (size < 40) {
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-lg bg-raised text-muted ring-1 ring-line" style={{ width: size, height: size }}>
        <UsersIcon className={size < 30 ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </span>
    );
  }
  const two = others.slice(0, 2);
  const small = Math.round(size * 0.72);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      {two[1] && (
        <span className="absolute right-0 top-0">
          <Avatar profile={asProfile(two[1])} size={small} />
        </span>
      )}
      <span className="absolute bottom-0 left-0 rounded-lg ring-2 ring-panel">
        {two[0] ? <Avatar profile={asProfile(two[0])} size={small} /> : <Avatar profile={undefined} size={small} />}
      </span>
    </span>
  );
}

export function ConversationList({ list, empty, compact = false }: { list: DmConversation[]; empty: string; compact?: boolean }) {
  const { me, base } = useDm();
  const pathname = usePathname();
  if (!list.length) return <p className="px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className={compact ? "px-2 py-2" : "divide-y divide-line"}>
      {list.map((c) => {
        const href = `${base}/${c.id}`;
        const active = pathname === href;
        const name = conversationName(c, me.id);
        const bold = c.unread > 0 && !c.muted && !active;
        return (
          <li key={c.id}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 ${compact ? "rounded-md px-2 py-2" : "px-4 py-3"} ${
                active ? "bg-raised" : "hover:bg-raised"
              } ${c.muted ? "opacity-70" : ""}`}
            >
              <ConversationAvatar c={c} meId={me.id} size={compact ? 32 : 40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`truncate text-sm ${bold ? "font-semibold text-fg" : "font-medium"}`}>{name}</span>
                  {c.muted && <BellOffIcon className="h-3.5 w-3.5 shrink-0 text-muted" />}
                  <span className="ml-auto shrink-0 text-xs text-muted">{sinceLabel(c.last_message?.created_at ?? c.created_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`truncate text-sm ${bold ? "text-fg" : "text-muted"}`}>{previewText(c, me.id)}</span>
                  {bold && (
                    <span className="ml-auto shrink-0 rounded-full bg-signal px-1.5 text-[11px] font-bold leading-[18px] text-signal-fg">
                      <span className="sr-only">Unread: </span>
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Chats / Requests tabs (arrow keys move between them). */
export function InboxTabs({ tab, setTab, requests, id }: { tab: InboxTab; setTab: (t: InboxTab) => void; requests: number; id: string }) {
  const tabs: [InboxTab, string][] = [
    ["chats", "Chats"],
    ["requests", requests ? `Requests · ${requests}` : "Requests"],
  ];
  return (
    <div role="tablist" aria-label="Conversations" className="flex gap-1 border-b border-line px-3">
      {tabs.map(([t, label], i) => (
        <button
          key={t}
          role="tab"
          id={`${id}-tab-${t}`}
          aria-selected={tab === t}
          aria-controls={`${id}-panel`}
          tabIndex={tab === t ? 0 : -1}
          className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${tab === t ? "border-signal font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
          onClick={() => setTab(t)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length][0];
            setTab(next);
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The inbox: what /dm shows, and the list beside a conversation on wide screens. */
export function DmInbox({ compact = false, initialTab = "chats" }: { compact?: boolean; initialTab?: InboxTab }) {
  const { base, conversations, loaded, refresh } = useDm();
  const community = useOptionalCommunity();
  const router = useRouter();
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [composing, setComposing] = useState(false);
  const { chats, requests, ignored } = splitInbox(conversations);
  const id = compact ? "dm-side" : "dm-main";
  const pathname = usePathname();
  // Beside an open request, show the Requests tab so it is in the list.
  const openState = (() => {
    const open = conversations.find((c) => pathname === `${base}/${c.id}`);
    return open ? requestState(open) : null;
  })();
  useEffect(() => {
    if (openState === "request" || openState === "ignored") setTab("requests");
    else if (openState === "chat") setTab("chats");
  }, [openState]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby={`${id}-title`}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        {community && !compact && (
          <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => community.setNavOpen(true)} aria-label="Open menu">
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        <h1 id={`${id}-title`} className="min-w-0 flex-1 truncate font-semibold">
          Direct messages
        </h1>
        <button className={compact ? "rounded p-1.5 text-muted hover:bg-raised hover:text-fg" : "btn-primary py-1.5"} onClick={() => setComposing(true)} title="New message">
          <PlusIcon className="h-4 w-4" />
          <span className={compact ? "sr-only" : ""}>New message</span>
        </button>
      </header>
      <InboxTabs tab={tab} setTab={setTab} requests={requests.length} id={id} />
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          <p className="px-4 py-6 text-sm text-muted">Loading…</p>
        ) : tab === "chats" ? (
          <ConversationList list={chats} compact={compact} empty="No conversations yet. Start one with New message." />
        ) : (
          <>
            {!compact && requests.length > 0 && (
              <p className="px-4 pt-3 text-xs text-muted">From people you haven&apos;t talked with yet. Accept to reply, or ignore it. Ignored requests don&apos;t notify you.</p>
            )}
            <ConversationList list={requests} compact={compact} empty="No message requests." />
            {ignored.length > 0 && (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-3 text-sm text-muted hover:text-fg">Ignored · {ignored.length}</summary>
                <ConversationList list={ignored} compact={compact} empty="" />
              </details>
            )}
          </>
        )}
      </div>
      {composing && (
        <NewMessageDialog
          onClose={() => setComposing(false)}
          onStarted={async (conv) => {
            setComposing(false);
            await refresh();
            router.push(`${base}/${conv}`);
          }}
        />
      )}
    </section>
  );
}
