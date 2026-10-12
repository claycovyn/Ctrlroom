import Link from "next/link";
import type { Metadata } from "next";
import { CommunityProvider } from "@/components/chat/CommunityContext";
import { Sidebar } from "@/components/chat/Sidebar";
import { Logo } from "@/components/Logo";
import { loadCommunity } from "@/lib/community";
import { JoinPublic } from "./JoinPublic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug, robots: { index: false } };
}

export default async function CommunityLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { community, role, me, rooms, communities } = await loadCommunity(slug);

  if (!role) {
    // Only public communities are visible to non-members (RLS hides the rest → 404 above).
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Link href="/app">
            <Logo />
          </Link>
          <div className="card mt-6 p-6">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-xl">
              {community.icon || community.name.slice(0, 1).toUpperCase()}
            </div>
            <h1 className="text-lg font-semibold">{community.name}</h1>
            {community.description && <p className="mt-1 text-sm text-muted">{community.description}</p>}
            <div className="mt-5">
              <JoinPublic slug={community.slug} />
            </div>
          </div>
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
      livekit={Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.NEXT_PUBLIC_LIVEKIT_URL)}
    >
      <div className="flex h-[100dvh] overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1">{children}</main>
      </div>
    </CommunityProvider>
  );
}
