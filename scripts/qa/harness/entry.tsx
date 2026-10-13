/* eslint-disable @typescript-eslint/no-explicit-any */
// QA harness: the real Ctrl Room app shell (src/app/c/[slug]/layout.tsx + its pages) against an in-memory backend.
// Built for production by ./build.mjs, served by ../serve.mjs; the Playwright scripts in ../ drive and measure it.
// URLs are the app's own: /c/<slug>/<room>, /c/<slug>/dm[/<id>], /c/<slug>/settings, /c/<slug>.
import "./hook";
import { createRoot } from "react-dom/client";
import { Profiler, useMemo } from "react";
import { usePathname, routeReady, ensureRoute, useRouter, useRouteVersion } from "./stubs/navigation";
import { CommunityProvider } from "@/components/chat/CommunityContext";
import { PresenceProvider } from "@/components/chat/PresenceContext";
import { DmProvider } from "@/components/dm/DmContext";
import { DmConversationPage, DmInboxPage } from "@/components/dm/DmPages";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatStage } from "@/components/chat/ChatStage";
import { RoomView } from "@/components/chat/RoomView";
import { SettingsView } from "@/components/chat/SettingsView";
import { DialogProvider } from "@/components/Dialogs";
import { NativeFeel } from "@/components/NativeFeel";
import { CommunityLanding } from "@/app/c/[slug]/CommunityLanding";
import RoomLoading from "@/app/c/[slug]/[room]/loading";
import type { Message } from "@/lib/types";
import * as D from "./data";

const W = window as any;
const qs = new URLSearchParams(location.search);
W.__lat = Number(qs.get("lat") ?? 40);
W.__serverMs = Number(qs.get("server") ?? 250);
try {
  localStorage.removeItem("ctrlroom:push-ask");
  localStorage.setItem("ctrlroom:push-ask", JSON.stringify({ dismissed: Date.now() }));
  if (qs.get("fresh")) localStorage.clear();
} catch {}

// ── the backend
const members = (cid: string) => D.profiles.map((p, i) => ({ community_id: cid, user_id: p.id, role: i === 0 ? "owner" : i < 3 ? "admin" : "member", joined_at: new Date(i * 1000).toISOString(), profiles: p }));
W.__db = {
  tables: {
    messages: D.messages,
    reactions: D.reactions,
    rooms: D.rooms,
    room_sections: D.sections,
    room_pins: D.pins.map((p) => ({ ...p, user_id: D.me.id })),
    profiles: D.profiles,
    community_members: D.communities.flatMap((c) => members(c.id)),
    board_items: [],
    bot_jobs: [],
    dm_messages: D.dmMessages,
    dm_reactions: [],
    dm_settings: [{ who_can_dm: "shared_community" }],
    invites: [],
    bans: [],
    join_requests: [],
    push_prefs: [],
    communities: D.communities,
  },
  rpc: {
    my_unreads: () => D.unreads,
    catch_up: () => ({ new_messages: 0 }),
    mark_read: () => null,
    my_dm_inbox: () => D.dmConversations,
    my_blocks: () => [],
    mark_dm_read: () => null,
    set_room_notify: () => null,
    join_requests_for: () => [],
    dm_search_people: () => D.profiles.slice(1, 8).map((p) => ({ ...p, can_message: true })),
    search_messages: (a: any) =>
      D.messages.filter((m) => m.body.toLowerCase().includes(String(a.p_query).toLowerCase())).slice(0, a.p_limit ?? 50).map((m) => ({ ...m, room_slug: D.rooms.find((r) => r.id === m.room_id)?.slug, room_name: D.rooms.find((r) => r.id === m.room_id)?.name, rank: 1 })),
    delete_message: (a: any) => {
      const m = D.messages.find((x) => x.id === a.p_message);
      if (m) m.deleted_at = new Date().toISOString();
      return null;
    },
  },
};
W.__peers = D.peers();
W.__data = D;

const perf = W.__perf as { commits: { id: string; phase: string; ms: number; at: number }[]; renders: Record<string, number> };
W.__perf = perf;
const onRender = (id: string, phase: string, actual: number) => perf.commits.push({ id, phase, ms: actual, at: performance.now() });

// ── "server" data per route, memoized like the RSC payload in the router cache
const layoutData = new Map<string, any>();
function communityData(slug: string) {
  let d = layoutData.get(slug);
  if (!d) {
    const community = D.communities.find((c) => c.slug === slug)!;
    d = {
      community,
      rooms: D.rooms.filter((r) => r.community_id === community.id),
      sections: D.sections.filter((x) => x.community_id === community.id),
      pins: D.pins.filter((p) => D.rooms.find((r) => r.id === p.room_id)?.community_id === community.id),
    };
    layoutData.set(slug, d);
  }
  return d;
}
const pageData = new Map<string, any>();
function roomData(roomId: string) {
  let d = pageData.get(roomId);
  if (!d) {
    const top = (W.__db.tables.messages as Message[]).filter((m) => m.room_id === roomId && !m.parent_id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const latest = top.slice(-50);
    const ids = new Set(latest.map((m) => m.id));
    const authors = new Set(latest.map((m) => m.author_id));
    d = {
      messages: latest,
      reactions: (W.__db.tables.reactions as any[]).filter((r) => ids.has(r.message_id)),
      profiles: D.profiles.filter((p) => authors.has(p.id)),
      hasMore: top.length > 50,
    };
    pageData.set(roomId, d);
  }
  return d;
}

function Page({ slug, rest }: { slug: string; rest: string[] }) {
  const path = usePathname();
  useRouteVersion();
  const { rooms } = communityData(slug);
  if (rest[0] === "dm") return rest[1] ? <DmConversationPage id={rest[1]} /> : <DmInboxPage />;
  if (rest[0] === "settings") return <SettingsView siteUrl="http://localhost" exportHref={`/api/c/${slug}/export`} />;
  if (!rest[0]) {
    const first = rooms.find((r: any) => r.slug === "general") ?? rooms[0];
    return <CommunityLanding slugs={rooms.map((r: any) => r.slug)} fallback={first?.slug ?? null} />;
  }
  const room = rooms.find((r: any) => r.slug === rest[0]);
  if (!room) return <div className="flex flex-1 items-center justify-center text-sm text-muted">Not found</div>;
  if (!routeReady(path)) {
    ensureRoute(path);
    return <RoomLoading />;
  }
  const d = roomData(room.id);
  return (
    <RoomView
      key={room.id}
      room={room}
      initialMessages={d.messages}
      initialReactions={d.reactions}
      initialBoard={[]}
      initialProfiles={d.profiles}
      hasMore={d.hasMore}
      focusMessageId={null}
    />
  );
}

function CommunityLayout({ slug, rest }: { slug: string; rest: string[] }) {
  const d = communityData(slug);
  return (
    <CommunityProvider me={D.me} role="owner" community={d.community} communities={D.communities} initialRooms={d.rooms} initialSections={d.sections} initialPins={d.pins} livekit={false}>
      <PresenceProvider>
        <DmProvider me={D.me} base={`/c/${slug}/dm`}>
          <div className="cr-shell cr-safe-top flex flex-col overflow-hidden">
            <ChatStage
              sidebar={
                <Profiler id="sidebar" onRender={onRender}>
                  <Sidebar />
                </Profiler>
              }
            >
              <Profiler id="page" onRender={onRender}>
                <Page slug={slug} rest={rest} />
              </Profiler>
            </ChatStage>
          </div>
        </DmProvider>
      </PresenceProvider>
    </CommunityProvider>
  );
}

function App() {
  const path = usePathname();
  const router = useRouter();
  const parts = useMemo(() => path.split("/").filter(Boolean), [path]);
  if (parts[0] !== "c" || !parts[1] || !D.communities.some((c) => c.slug === parts[1])) {
    queueMicrotask(() => router.replace("/c/night-shift/general"));
    return null;
  }
  return (
    <Profiler id="app" onRender={onRender}>
      <CommunityLayout key={parts[1]} slug={parts[1]} rest={parts.slice(2)} />
    </Profiler>
  );
}

W.__t0 = performance.now();
createRoot(document.getElementById("root")!).render(
  <DialogProvider>
    <App />
    <NativeFeel />
  </DialogProvider>,
);
