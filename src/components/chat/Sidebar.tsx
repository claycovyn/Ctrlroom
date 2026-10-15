"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityCover, CommunityIcon } from "@/components/CommunityMedia";
import { usePrompt } from "@/components/Dialogs";
import { LogoMark } from "@/components/Logo";
import { cloudErrorText } from "@/lib/cloudErrors";
import { useBroadcast } from "@/lib/realtime";
import { applyChange, nextPosition, readCollapsed, renameSectionDialog, sidebarLayout, writeCollapsed } from "@/lib/rooms";
import { disablePush, isPushActive } from "@/lib/pushClient";
import { installSoundUnlock, play } from "@/lib/sounds";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Room, type RoomSection, type Unread } from "@/lib/types";
import type { NewRoom } from "./AddRoomDialog";
import { NotificationsButton } from "./NotificationsButton";
import { lastRoom, navigateWithTransition, prefetchRoute } from "./roomNav";

import { useOptionalDm } from "@/components/dm/DmContext";
import { badgeLabel } from "@/lib/dms";
import { keepNavOpenForNextCommunity, useCommunity } from "./CommunityContext";
import { BellIcon, ChatsIcon, ChevronDownIcon, FeedIcon, CloseIcon, MoreIcon, PinIcon, PlusIcon, SearchIcon, SettingsIcon, UserPlusIcon } from "./icons";
import { OPEN_PANEL } from "./roomNav";
import { HeadsetIcon } from "./icons";
import { Avatar } from "./Avatar";
import { usePresence } from "./PresenceContext";
import { RoomIcon } from "./RoomIcon";
import { StatusMenu } from "./StatusMenu";

// Admins only, on a tap: not part of every page load.
const AddRoomDialog = dynamic(() => import("./AddRoomDialog").then((m) => m.AddRoomDialog), { ssr: false });

export function Sidebar() {
  const ctx = useCommunity();
  const presence = usePresence();
  const myStatus = presence ? (presence.manual === "invisible" ? "Appear offline" : presence.statusOf(ctx.me.id).label) : null;
  const { me, role, community, communities, rooms, setRooms, sections, setSections, pins, togglePin, unreads, setUnreads, currentRoomId, setNavOpen } = ctx;
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = atLeast(role, "admin");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const promptDialog = usePrompt();
  const dm = useOptionalDm();
  const dmHref = `/c/${community.slug}/dm`;
  const inDm = pathname === dmHref || pathname.startsWith(`${dmHref}/`);
  const [addingIn, setAddingIn] = useState<RoomSection | null>(null);
  // Pending join requests (0008), owners and admins only. Refreshed on the join_request event below.
  const [requests, setRequests] = useState(0);
  const loadRequests = useCallback(async () => {
    if (!isAdmin) return setRequests(0);
    const { count } = await supabaseBrowser()
      .from("join_requests")
      .select("id", { count: "exact", head: true })
      .eq("community_id", community.id)
      .eq("status", "pending");
    setRequests(count ?? 0);
  }, [isAdmin, community.id]);
  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => setCollapsed(readCollapsed(community.id)), [community.id]);
  const toggleCollapsed = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    setCollapsed(next);
    writeCollapsed(community.id, next);
  };
  const flash = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  useEffect(() => {
    installSoundUnlock();
  }, []);

  useEffect(() => {
    supabaseBrowser()
      .rpc("my_unreads", { p_community: community.id })
      .then(({ data }) => {
        const map: Record<string, Unread> = {};
        ((data ?? []) as Unread[]).forEach((u) => (map[u.room_id] = u));
        if (currentRoomId.current && map[currentRoomId.current]) {
          map[currentRoomId.current] = { ...map[currentRoomId.current], unread: 0, mentions: 0 };
        }
        setUnreads(map);
      });
  }, [community.id, currentRoomId, setUnreads]);

  // Going somewhere else shows it (the chat slides back over the rooms on a phone). Not on mount: a community opened
  // from the rail on a phone keeps the rooms showing.
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    setNavOpen(false);
  }, [pathname, setNavOpen]);

  /** Phones: another community from the rail opens its rooms (over its last room, when there is one), like a native app. */
  const communityHref = (slug: string) => {
    const last = lastRoom(slug);
    return last ? `/c/${slug}/${last}` : `/c/${slug}`;
  };
  const openCommunity = (e: React.MouseEvent<HTMLAnchorElement>, slug: string) => {
    if (slug === community.slug || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    e.preventDefault();
    keepNavOpenForNextCommunity();
    router.push(communityHref(slug));
  };

  const notify = (title: string, body: string, url: string) => {
    // With push on for this device the system notification comes from the service worker instead.
    if (isPushActive() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, tag: url });
      n.onclick = () => {
        window.focus();
        window.location.href = url;
      };
    } catch {
      // Android Chrome only shows notifications from a service worker
    }
  };

  useBroadcast(`community:${community.id}`, {
    activity: (p: { room_id: string; author_id: string; thread: boolean }) => {
      if (p.author_id === me.id || p.thread) return;
      // A short wait lets a mention chime for the same message (user topic) land first; soundAllowed skips the tap.
      const roomNotify = unreads[p.room_id]?.notify ?? "mentions";
      setTimeout(() => play("message", { roomNotify, roomId: p.room_id, viewingRoomId: currentRoomId.current }), 300);
      if (p.room_id === currentRoomId.current) return;
      setUnreads((u) => {
        const cur = u[p.room_id] ?? { room_id: p.room_id, unread: 0, mentions: 0, notify: "mentions" as const };
        if (cur.notify === "all" && document.hidden) {
          const room = rooms.find((r) => r.id === p.room_id);
          if (room) notify(`#${room.name}`, `New message in ${community.name}`, `/c/${community.slug}/${room.slug}`);
        }
        return { ...u, [p.room_id]: { ...cur, unread: Math.min(cur.unread + 1, 100) } };
      });
    },
    rooms: (p: { op: string; room: Room }) => setRooms((list) => applyChange(list, p.op, p.room)),
    sections: (p: { op: string; section: RoomSection }) => setSections((list) => applyChange(list, p.op, p.section)),
  });

  useBroadcast(`user:${me.id}`, {
    // Direct messages (0011) share this channel (one per topic); DmProvider handles them.
    dm: (p: unknown) => dm?.handlers.dm(p),
    dm_update: (p: unknown) => dm?.handlers.dm_update(p),
    dm_reaction: (p: unknown) => dm?.handlers.dm_reaction(p),
    dm_conversation: (p: unknown) => dm?.handlers.dm_conversation(p),
    // Sent to owners and admins when a request in one of their communities is made, answered or withdrawn.
    join_request: (p: { community_id: string }) => {
      if (p.community_id !== community.id) return;
      loadRequests();
      window.dispatchEvent(new CustomEvent("ctrlroom:join-requests"));
    },
    mention: (p: { kind: string; room_id: string; community_id: string; author: string; preview: string }) => {
      // The user topic carries mentions from every community; the room's mute setting is only known for this one.
      play("mention", { roomNotify: p.community_id === community.id ? (unreads[p.room_id]?.notify ?? "mentions") : undefined });
      if (p.community_id === community.id && p.room_id !== currentRoomId.current) {
        setUnreads((u) => {
          const cur = u[p.room_id] ?? { room_id: p.room_id, unread: 0, mentions: 0, notify: "mentions" as const };
          return { ...u, [p.room_id]: { ...cur, mentions: cur.mentions + 1 } };
        });
      }
      const room = rooms.find((r) => r.id === p.room_id);
      if (document.hidden || p.room_id !== currentRoomId.current) {
        if (unreads[p.room_id]?.notify !== "none") {
          notify(
            p.kind === "reply" ? `${p.author} replied to you` : `${p.author} mentioned you`,
            p.preview,
            room ? `/c/${community.slug}/${room.slug}` : `/c/${community.slug}`,
          );
        }
      }
    },
  });

  const layout = sidebarLayout(rooms, sections, pins);
  const text = layout.loose.filter((r) => r.kind === "text");
  const voice = layout.loose.filter((r) => r.kind === "voice");

  const renameSection = async (sec: RoomSection) => {
    const name = await promptDialog(renameSectionDialog(sec.name));
    if (!name || name === sec.name) return;
    const { error: err } = await supabaseBrowser().from("room_sections").update({ name }).eq("id", sec.id);
    if (err) return flash("Couldn't rename the section.");
    setSections((list) => applyChange(list, "update", { ...sec, name }));
    router.refresh();
  };

  /** Saves a room from AddRoomDialog; returns the error to show in the dialog, or null (and closes it). */
  const addRoomIn = async (sec: RoomSection, { slug, kind, icon }: NewRoom): Promise<string | null> => {
    const { data, error: err } = await supabaseBrowser()
      .from("rooms")
      .insert({
        community_id: community.id,
        slug,
        name: slug,
        kind,
        icon,
        section_id: sec.id,
        position: nextPosition(rooms.filter((r) => r.section_id === sec.id)),
      })
      .select()
      .single();
    if (err) return err.code === "23505" ? `#${slug} already exists.` : (cloudErrorText(err.message) ?? "Couldn't add the room.");
    setRooms((list) => applyChange(list, "insert", data as Room));
    setAddingIn(null);
    router.refresh();
    return null;
  };

  const onPin = async (id: string) => {
    const err = await togglePin(id);
    if (err) flash(err);
  };

  return (
    <>
      {/* Tablets in portrait without the md layout never get here; on phones ChatStage puts this under the chat. */}
      <aside
        className="cr-drawer cr-chrome fixed inset-y-0 left-0 z-40 flex w-[min(19rem,88vw)] shrink-0 border-r border-line bg-panel md:static md:w-[19rem]"
      >
        {/* community rail */}
        <nav className="scroll-thin flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-bg py-3" aria-label="Communities">
          <Link href="/app" title="All communities" className="mb-1">
            <LogoMark className="h-10 w-10" />
          </Link>
          {dm && (
            <Link
              href={dmHref}
              title="Direct messages"
              aria-label={dm.badge > 0 ? `Direct messages, ${badgeLabel(dm.badge)} new` : "Direct messages"}
              aria-current={inDm ? "page" : undefined}
              className={`relative mb-1 flex h-10 w-10 items-center justify-center rounded-xl ${inDm ? "bg-signal text-signal-fg" : "bg-raised text-muted hover:bg-line hover:text-fg"}`}
            >
              <ChatsIcon className="h-5 w-5" />
              {dm.badge > 0 && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg">
                  {badgeLabel(dm.badge)}
                </span>
              )}
            </Link>
          )}
          <Link href="/app/feed" title="Feed" aria-label="Feed" className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-muted hover:bg-line hover:text-fg">
            <FeedIcon className="h-5 w-5" />
          </Link>
          <span aria-hidden="true" className="mb-1 h-px w-8 bg-line" />
          {communities.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              onClick={(e) => openCommunity(e, c.slug)}
              onTouchStart={() => c.id !== community.id && prefetchRoute(router, communityHref(c.slug))}
              title={c.name}
              aria-current={c.id === community.id && !inDm ? "page" : undefined}
              className={`rounded-xl transition-colors ${
                c.id === community.id && !inDm && community.icon_url ? "ring-2 ring-signal ring-offset-2 ring-offset-bg" : ""
              }`}
            >
              <CommunityIcon
                community={c}
                className={`h-10 w-10 rounded-xl text-lg ${
                  c.id === community.id && !inDm ? "bg-signal text-signal-fg" : "bg-raised hover:bg-line"
                }`}
              />
            </Link>
          ))}
          <Link href="/app" title="Create or join" className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-line text-muted hover:text-fg">
            <PlusIcon />
          </Link>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <CommunityCover url={community.cover_url} className="border-b border-line" />
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <Link href={`/c/${community.slug}/settings`} className="min-w-0 truncate font-semibold hover:underline" title="Community info and settings">
              {community.name}
            </Link>
            <div className="flex items-center">
              <Link
                href={requests > 0 ? `/c/${community.slug}/settings#requests` : `/c/${community.slug}/settings`}
                className="relative rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
                title={requests > 0 ? `Community settings · ${requests} join ${requests === 1 ? "request" : "requests"}` : "Community settings"}
              >
                <SettingsIcon />
                {requests > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-signal px-1 text-center text-[10px] font-semibold leading-4 text-signal-fg">
                    {requests > 99 ? "99+" : requests}
                  </span>
                )}
              </Link>
              <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(false)} aria-label="Back to the chat">
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Phones: search and invite at the top of the rooms, like a native chat app's navigation. */}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 md:hidden">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-raised px-3 py-2 text-left text-sm text-muted"
              onClick={() => {
                setNavOpen(false);
                window.dispatchEvent(new CustomEvent(OPEN_PANEL, { detail: "search" }));
              }}
            >
              <SearchIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">Search {community.name}</span>
            </button>
            {atLeast(role, "mod") && (
              <Link
                href={`/c/${community.slug}/settings#invites`}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-sm font-medium"
                title="Invite people"
              >
                <UserPlusIcon className="h-4 w-4" /> Invite
              </Link>
            )}
          </div>

          <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
            {error && (
              <p role="alert" className="mx-2 mb-2 text-xs text-alert">
                {error}
              </p>
            )}
            {layout.pinned.length > 0 && roomGroup("Pinned", layout.pinned, true)}
            {(text.length > 0 || layout.sections.length === 0) && roomGroup("Rooms", text)}
            {voice.length > 0 && roomGroup("Voice", voice)}
            {layout.sections.map(({ section, rooms: list, total }) => {
              if (total === 0 && !isAdmin) return null;
              const shut = collapsed.includes(section.id);
              return (
                <div key={section.id} className="mb-4">
                  <div className="flex items-center gap-1 pr-1">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg"
                      onClick={() => toggleCollapsed(section.id)}
                      aria-expanded={!shut}
                    >
                      <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${shut ? "-rotate-90" : ""}`} />
                      <span className="truncate">{section.name}</span>
                    </button>
                    {isAdmin && (
                      <details className="relative">
                        <summary
                          className="flex cursor-pointer list-none items-center rounded p-1 text-muted hover:bg-raised hover:text-fg [&::-webkit-details-marker]:hidden"
                          aria-label={`Options for ${section.name}`}
                          title="Section options"
                        >
                          <MoreIcon className="h-3.5 w-3.5" />
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-line bg-panel py-1 text-sm shadow-lg">
                          <SectionMenuButton onClick={() => setAddingIn(section)}>Add a room here</SectionMenuButton>
                          <SectionMenuButton onClick={() => renameSection(section)}>Rename</SectionMenuButton>
                          <Link href={`/c/${community.slug}/settings#rooms`} className="block px-3 py-1.5 hover:bg-raised">
                            Order and delete
                          </Link>
                        </div>
                      </details>
                    )}
                  </div>
                  {!shut &&
                    (total === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted">No rooms yet. Add one from the … menu, or move rooms here in Settings.</p>
                    ) : (
                      roomList(list)
                    ))}
                </div>
              );
            })}
            {isAdmin && (
              <Link href={`/c/${community.slug}/settings#rooms`} className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-raised hover:text-fg">
                <PlusIcon className="h-4 w-4" /> Add a room
              </Link>
            )}
          </div>

          <NotificationsButton settingsHref={`/c/${community.slug}/settings`} />

          <div className="flex items-center gap-2 border-t border-line px-3 py-3">
            <StatusMenu me={me} settingsHref={`/c/${community.slug}/settings#profile`} />
            {/* The name and status open the same status menu as the avatar. */}
            <div
              className="min-w-0 flex-1 cursor-pointer leading-tight"
              onClick={(e) => e.currentTarget.parentElement?.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")?.click()}
            >
              <div className="truncate text-sm font-medium">{me.display_name}</div>
              <div className="truncate text-xs text-muted">{myStatus ?? `@${me.username}`}</div>
            </div>
            <Link
              href={`/c/${community.slug}/settings#notifications`}
              className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
              title="Notifications and settings"
              aria-label="Notifications and settings"
            >
              <BellIcon className="h-4 w-4" />
            </Link>
            <Link href="/docs" className="rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg" title="Help and docs">
              Help
            </Link>
            <form
              action="/auth/signout"
              method="post"
              onSubmit={(e) => {
                // A signed-out phone shouldn't keep getting this account's notifications.
                if (!isPushActive()) return;
                e.preventDefault();
                const form = e.currentTarget;
                Promise.race([disablePush(), new Promise((r) => setTimeout(r, 1500))]).finally(() => form.submit());
              }}
            >
              <button className="rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      {addingIn && <AddRoomDialog section={addingIn} onCancel={() => setAddingIn(null)} onCreate={(room) => addRoomIn(addingIn, room)} />}
    </>
  );

  function roomGroup(title: string, rooms: Room[], isPinned = false) {
    return (
      <div className="mb-4">
        <h3 className="mb-1 flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {isPinned && <PinIcon className="h-3 w-3" />}
          {title}
        </h3>
        {roomList(rooms)}
      </div>
    );
  }

  function roomList(rooms: Room[]) {
    return (
      <ul>
        {rooms.map((r) => {
          const u = unreads[r.id];
          const active = pathname === `/c/${community.slug}/${r.slug}`;
          const bold = !active && u && u.unread > 0 && u.notify !== "none";
          const isPinned = pins.some((p) => p.room_id === r.id);
          return (
            <li key={r.id} className="group relative flex flex-wrap items-center">
              <Link
                href={`/c/${community.slug}/${r.slug}`}
                onPointerEnter={() => prefetchRoute(router, `/c/${community.slug}/${r.slug}`)}
                onTouchStart={() => prefetchRoute(router, `/c/${community.slug}/${r.slug}`)}
                onClick={(e) => {
                  // The room you're in: just show it again (a phone with the rooms showing).
                  if (active && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                    e.preventDefault();
                    setNavOpen(false);
                    return;
                  }
                  navigateWithTransition(e, router, `/c/${community.slug}/${r.slug}`);
                }}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 pr-8 text-sm md:py-1.5 ${
                  active ? "bg-raised font-medium text-fg" : bold ? "font-semibold text-fg hover:bg-raised" : "text-muted hover:bg-raised hover:text-fg"
                } ${u?.notify === "none" && !active ? "opacity-60" : ""}`}
              >
                <RoomIcon room={r} className="h-4 w-4 shrink-0 opacity-70" />
                <span className="truncate">{r.name}</span>
                {!active && u && u.mentions > 0 ? (
                  <span className="ml-auto rounded-full bg-signal px-1.5 text-[11px] font-bold text-signal-fg">{u.mentions}</span>
                ) : (
                  bold && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-fg" aria-label="New messages" />
                )}
              </Link>
              <button
                className={`absolute right-1 top-[5px] rounded p-1 text-muted hover:bg-line hover:text-fg focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60 ${
                  isPinned ? "opacity-60" : "opacity-0"
                }`}
                onClick={() => onPin(r.id)}
                aria-label={isPinned ? `Unpin ${r.name}` : `Pin ${r.name}`}
                aria-pressed={isPinned}
                title={isPinned ? "Unpin" : "Pin to top (just for you)"}
              >
                <PinIcon className="h-3.5 w-3.5" />
              </button>
              <CallPeople ids={presence?.calls[r.id] ?? []} roomName={r.name} />
            </li>
          );
        })}
      </ul>
    );
  }
}

function SectionMenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left hover:bg-raised"
      onClick={(e) => {
        e.currentTarget.closest("details")?.removeAttribute("open");
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Who's in the call in a room: up to 4 faces, then a count. */
function CallPeople({ ids, roomName }: { ids: string[]; roomName: string }) {
  const { profiles, ensureProfiles } = useCommunity();
  const key = ids.join(",");
  useEffect(() => {
    if (key) ensureProfiles(key.split(","));
  }, [key, ensureProfiles]);
  if (!ids.length) return null;
  const names = ids.map((id) => profiles[id]?.display_name ?? "someone");
  const shown = ids.slice(0, 4);
  return (
    <div className="flex basis-full items-center gap-1.5 pb-1 pl-8 pr-2 text-xs text-muted" title={names.join(", ")}>
      <HeadsetIcon className="h-3 w-3 shrink-0" />
      <span className="sr-only">
        In the call in #{roomName}: {names.join(", ")}
      </span>
      <span aria-hidden="true" className="flex -space-x-0.5">
        {shown.map((id) => (
          <span key={id} className="rounded-md ring-2 ring-panel">
            <Avatar profile={profiles[id] ?? { id, username: "", display_name: "?", avatar_url: null }} size={18} />
          </span>
        ))}
      </span>
      <span aria-hidden="true">{ids.length}</span>
    </div>
  );
}

