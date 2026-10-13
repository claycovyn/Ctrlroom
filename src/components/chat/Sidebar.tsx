"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CommunityCover, CommunityIcon } from "@/components/CommunityMedia";
import { LogoMark } from "@/components/Logo";
import { useBroadcast } from "@/lib/realtime";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Room, type Unread } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useCommunity } from "./CommunityContext";
import { BellIcon, CloseIcon, HashIcon, MegaphoneIcon, PlusIcon, SettingsIcon, VoiceIcon } from "./icons";

export function Sidebar() {
  const ctx = useCommunity();
  const { me, role, community, communities, rooms, setRooms, unreads, setUnreads, currentRoomId, navOpen, setNavOpen } = ctx;
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<NotificationPermission | "unsupported">("default");

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
    rooms: (p: { op: string; room: Room }) => {
      setRooms((list) => {
        const rest = list.filter((r) => r.id !== p.room.id);
        const next = p.op === "delete" ? rest : [...rest, p.room];
        return next.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
      });
    },
  });

  useBroadcast(`user:${me.id}`, {
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

  const text = rooms.filter((r) => r.kind === "text");
  const voice = rooms.filter((r) => r.kind === "voice");

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
              <Link href={`/c/${community.slug}/settings`} className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg" title="Community settings">
                <SettingsIcon />
              </Link>
              <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
            {roomGroup("Rooms", text)}
            {voice.length > 0 && roomGroup("Voice", voice)}
            {atLeast(role, "admin") && (
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
    </>
  );

  function roomGroup(title: string, rooms: Room[]) {
    return (
      <div className="mb-4">
        <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        <ul>
          {rooms.map((r) => {
            const u = unreads[r.id];
            const active = pathname === `/c/${community.slug}/${r.slug}`;
            const bold = !active && u && u.unread > 0 && u.notify !== "none";
            const Icon = r.kind === "voice" ? VoiceIcon : r.post_min_role !== "member" ? MegaphoneIcon : HashIcon;
            return (
              <li key={r.id}>
                <Link
                  href={`/c/${community.slug}/${r.slug}`}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    active ? "bg-raised font-medium text-fg" : bold ? "font-semibold text-fg hover:bg-raised" : "text-muted hover:bg-raised hover:text-fg"
                  } ${u?.notify === "none" && !active ? "opacity-60" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="truncate">{r.name}</span>
                  {!active && u && u.mentions > 0 && (
                    <span className="ml-auto rounded-full bg-signal px-1.5 text-[11px] font-bold text-signal-fg">{u.mentions}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}
