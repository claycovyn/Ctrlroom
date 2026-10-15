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
import { AppShell } from "@/components/shell/AppShell";
import { CommunitiesPage } from "@/components/shell/CommunitiesPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import { SettingsPage } from "@/components/shell/SettingsPage";
import { ActivityView } from "@/components/social/ActivityView";
import { FeedView } from "@/components/social/FeedView";
import { ProfileView } from "@/components/social/ProfileView";
import * as D from "./data";
import * as S from "./social";

const W = window as any;
const qs = new URLSearchParams(location.search);
W.__lat = Number(qs.get("lat") ?? 40);
W.__serverMs = Number(qs.get("server") ?? 250);
try {
  localStorage.removeItem("ctrlroom:push-ask");
  localStorage.setItem("ctrlroom:push-ask", JSON.stringify({ dismissed: Date.now() }));
  if (qs.get("fresh")) localStorage.clear();
} catch {}

// ?store=1: screenshots for the OpenCtrl Store listing, without the removed-message placeholders the QA data has.
if (qs.get("store")) for (let i = D.messages.length - 1; i >= 0; i--) if (D.messages[i].deleted_at) D.messages.splice(i, 1);

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
    communities: [...D.communities, ...S.exploreCommunities],
    post_cards: S.posts,
    follows: [],
    community_follows: [],
  },
  rpc: {
    my_unreads: (a: any) => (a.p_community ? S.unreadsFor(a.p_community, D.unreads) : D.unreads),
    feed_posts: (a: any) => S.feed(a.p_scope),
    my_activity_unseen: () => 3,
    my_activity: () => S.activity,
    mark_activity_seen: () => null,
    profile_view: (a: any) => [S.profileView(a.p_username)].filter(Boolean),
    profile_follows: () => S.followers,
    my_follow_requests: () => [],
    follow_user: () => "active",
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

/** The signed-in shell (src/app/(shell)/layout.tsx) and its pages, with the data their server pages would load. */
function ShellPage({ parts }: { parts: string[] }) {
  useRouteVersion();
  const tab = new URLSearchParams(location.search).get("tab") === "everyone" ? "everyone" : "following";
  if (parts[0] === "u") {
    const profile = S.profileView(parts[1]);
    if (!profile) return <PageHeader title="Not found" back="/app" />;
    return <ProfileView key={parts[1]} me={S.shellMe} profile={profile} initialPosts={S.posts.filter((p) => p.author_id === profile.id)} requests={[]} />;
  }
  if (parts[1] === "communities")
    return (
      <>
        <PageHeader title="Communities" sub="Rooms, threads and voice" />
        <CommunitiesPage />
      </>
    );
  if (parts[1] === "settings") return <SettingsPage email="alex@example.com" />;
  if (parts[1] === "feed" && parts[2] === "activity") return <ActivityView me={S.shellMe} items={S.activity} />;
  return <FeedView key={tab} me={S.shellMe} scope={tab} initial={S.feed(tab)} following={S.following} followedCommunities={[]} />;
}

function App() {
  const path = usePathname();
  const router = useRouter();
  const parts = useMemo(() => path.split("/").filter(Boolean), [path]);
  if ((parts[0] === "app" && parts[1] !== "dm") || (parts[0] === "u" && parts[1])) {
    return (
      <AppShell me={S.shellMe} communities={S.shellCommunities} cloud={false}>
        <ShellPage parts={parts} />
      </AppShell>
    );
  }
  if (parts[0] === "app" && parts[1] === "dm") {
    queueMicrotask(() => router.replace("/c/night-shift/dm" + (parts[2] ? "/" + parts[2] : "")));
    return null;
  }
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
