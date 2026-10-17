import Link from "next/link";
import type { Metadata } from "next";
import { CommunityProvider } from "@/components/chat/CommunityContext";
import { DmProvider } from "@/components/dm/DmContext";
import { PresenceProvider } from "@/components/chat/PresenceContext";
import { ChatStage } from "@/components/chat/ChatStage";
import { Sidebar } from "@/components/chat/Sidebar";
import { CommunityCover, CommunityIcon } from "@/components/CommunityMedia";
import { Logo } from "@/components/Logo";
import { PushPrompt } from "@/components/push/PushPrompt";
import { loadCommunity } from "@/lib/community";
import { atLeast } from "@/lib/types";
import { JoinPublic } from "./JoinPublic";
import { RequestToJoin } from "./RequestToJoin";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug, robots: { index: false } };
}

export default async function CommunityLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { community, request, role, me, rooms, sections, pins, communities } = await loadCommunity(slug);

  if (!role) {
    // Non-members see public communities (join) and private ones that accept requests (ask to join);
    // RLS and community_request_card hide the rest → 404 in loadCommunity.
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Link href="/app">
            <Logo />
          </Link>
          <div className="card mt-6 overflow-hidden">
            <CommunityCover url={community.cover_url} className="border-b border-line" />
            <div className="p-6">
              <CommunityIcon community={community} className="mb-3 h-12 w-12 rounded-xl bg-raised text-xl" />
              <h1 className="text-lg font-semibold">{community.name}</h1>
              {community.description && <p className="mt-1 text-sm text-muted">{community.description}</p>}
              <div className="mt-5">
                {request ? <RequestToJoin slug={community.slug} pending={request.pending} /> : <JoinPublic slug={community.slug} />}
              </div>
            </div>
          </div>
          {/* Reports cover public communities and your own (0003 report()); a request card is neither. */}
          {!request && (
            <p className="mt-3 text-center text-xs text-muted">
              <Link href={`/report/${community.slug}`} className="hover:text-fg">
                Report this community
              </Link>
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <CommunityProvider
      me={me}
      role={role}
      community={community}
      communities={communities}
      initialRooms={rooms}
      initialSections={sections}
      initialPins={pins}
      livekit={Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.NEXT_PUBLIC_LIVEKIT_URL)}
    >
      <PresenceProvider>
        {/* Direct messages (0011) aren't part of the community; they're mounted here for the rail badge and alerts. */}
        <DmProvider me={me} base={`/c/${community.slug}/dm`}>
        <div className="cr-shell cr-safe-top flex flex-col overflow-hidden">
          {community.taken_down_at && (
            <p role="alert" className="shrink-0 border-b border-line bg-alert/15 px-4 py-2 text-center text-sm">
              This community was taken down{community.taken_down_reason ? `: ${community.taken_down_reason}` : ""}. New messages,
              calls and joins are off. History stays readable{atLeast(role, "admin") ? ", and you can export it from Settings" : ""}.
            </p>
          )}
          <ChatStage sidebar={<Sidebar />}>{children}</ChatStage>
          <PushPrompt />
        </div>
        </DmProvider>
      </PresenceProvider>
    </CommunityProvider>
  );
}
