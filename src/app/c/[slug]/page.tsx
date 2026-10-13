import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadCommunity } from "@/lib/community";
import { CommunityLanding } from "./CommunityLanding";

// Phones (iPhone, Android phones): land on the rooms or the last room, chosen in the browser (CommunityLanding).
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i;

export default async function CommunityIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { rooms, role } = await loadCommunity(slug);
  if (!role) return null;
  const first = rooms.find((r) => r.slug === "general") ?? rooms.find((r) => r.kind === "text") ?? rooms[0];
  if (PHONE_UA.test((await headers()).get("user-agent") ?? "")) {
    return <CommunityLanding slugs={rooms.map((r) => r.slug)} fallback={first?.slug ?? null} />;
  }
  if (first) redirect(`/c/${slug}/${first.slug}`);
  return <div className="flex flex-1 items-center justify-center text-sm text-muted">No rooms yet.</div>;
}
