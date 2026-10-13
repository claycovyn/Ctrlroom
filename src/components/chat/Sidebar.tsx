"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CommunityCover, CommunityIcon } from "@/components/CommunityMedia";
import { usePrompt } from "@/components/Dialogs";
import { LogoMark } from "@/components/Logo";
import { cloudErrorText } from "@/lib/cloudErrors";
import { useBroadcast } from "@/lib/realtime";
import { applyChange, nextPosition, readCollapsed, sidebarLayout, writeCollapsed } from "@/lib/rooms";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Room, type RoomSection, type Unread } from "@/lib/types";
import { AddRoomDialog, type NewRoom } from "./AddRoomDialog";
import { Avatar } from "./Avatar";
import { useCommunity } from "./CommunityContext";
import { BellIcon, ChevronDownIcon, CloseIcon, MoreIcon, PinIcon, PlusIcon, SettingsIcon } from "./icons";
import { RoomIcon } from "./RoomIcon";
import { renameSectionDialog } from "./RoomsSettings";

export function Sidebar() {
  const ctx = useCommunity();
  const { me, role, community, communities, rooms, setRooms, sections, setSections, pins, togglePin, unreads, setUnreads, currentRoomId, navOpen, setNavOpen } = ctx;
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = atLeast(role, "admin");
  const [alerts, setAlerts] = useState<NotificationPermission | "unsupported">("default");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const promptDialog = usePrompt();
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
    setAlerts(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
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

  useEffect(() => setNavOpen(false), [pathname, setNavOpen]);

  const notify = (title: string, body: string, url: string) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag: url });
    n.onclick = () => {
      window.focus();
      window.location.href = url;
    };
  };

  useBroadcast(`community:${community.id}`, {
    activity: (p: { room_id: string; author_id: string; thread: boolean }) => {
      if (p.author_id === me.id || p.room_id === currentRoomId.current || p.thread) return;
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
    // Sent to owners and admins when a request in one of their communities is made, answered or withdrawn.
    join_request: (p: { community_id: string }) => {
      if (p.community_id !== community.id) return;
      loadRequests();
      window.dispatchEvent(new CustomEvent("ctrlroom:join-requests"));
    },
    mention: (p: { kind: string; room_id: string; community_id: string; author: string; preview: string }) => {
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
      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[19rem] shrink-0 border-r border-line bg-panel transition-transform md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* community rail */}
        <nav className="scroll-thin flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-bg py-3" aria-label="Communities">
          <Link href="/app" title="All communities" className="mb-1">
            <LogoMark className="h-10 w-10" />
          </Link>
          {communities.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              title={c.name}
              aria-current={c.id === community.id ? "page" : undefined}
              className={`rounded-xl transition-colors ${
                c.id === community.id && community.icon_url ? "ring-2 ring-signal ring-offset-2 ring-offset-bg" : ""
              }`}
            >
              <CommunityIcon
                community={c}
                className={`h-10 w-10 rounded-xl text-lg ${
                  c.id === community.id ? "bg-signal text-signal-fg" : "bg-raised hover:bg-line"
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
            <span className="truncate font-semibold">{community.name}</span>
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
              <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <CloseIcon />
              </button>
            </div>
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

          {alerts === "default" && (
            <button
              className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-xs text-muted hover:text-fg"
              onClick={async () => setAlerts(await Notification.requestPermission())}
            >
              <BellIcon className="h-4 w-4 shrink-0" />
              Turn on desktop alerts for mentions and replies
            </button>
          )}

          <div className="flex items-center gap-2 border-t border-line px-3 py-3">
            <Link href={`/c/${community.slug}/settings#profile`} className="shrink-0 rounded-lg" title="Change your photo" aria-label="Change your photo">
              <Avatar profile={me} size={32} />
            </Link>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{me.display_name}</div>
              <div className="truncate text-xs text-muted">@{me.username}</div>
            </div>
            <Link href="/docs" className="rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg" title="Help and docs">
              Help
            </Link>
            <form action="/auth/signout" method="post">
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
            <li key={r.id} className="group relative flex items-center">
              <Link
                href={`/c/${community.slug}/${r.slug}`}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm ${
                  active ? "bg-raised font-medium text-fg" : bold ? "font-semibold text-fg hover:bg-raised" : "text-muted hover:bg-raised hover:text-fg"
                } ${u?.notify === "none" && !active ? "opacity-60" : ""}`}
              >
                <RoomIcon room={r} className="h-4 w-4 shrink-0 opacity-70" />
                <span className="truncate">{r.name}</span>
                {!active && u && u.mentions > 0 && (
                  <span className="ml-auto rounded-full bg-signal px-1.5 text-[11px] font-bold text-signal-fg">{u.mentions}</span>
                )}
              </Link>
              <button
                className={`absolute right-1 rounded p-1 text-muted hover:bg-line hover:text-fg focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60 ${
                  isPinned ? "opacity-60" : "opacity-0"
                }`}
                onClick={() => onPin(r.id)}
                aria-label={isPinned ? `Unpin ${r.name}` : `Pin ${r.name}`}
                aria-pressed={isPinned}
                title={isPinned ? "Unpin" : "Pin to top (just for you)"}
              >
                <PinIcon className="h-3.5 w-3.5" />
              </button>
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
