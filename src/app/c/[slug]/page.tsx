import { redirect } from "next/navigation";
import { loadCommunity } from "@/lib/community";

export default async function CommunityIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { rooms, role } = await loadCommunity(slug);
  if (!role) return null;
  const first = rooms.find((r) => r.slug === "general") ?? rooms.find((r) => r.kind === "text") ?? rooms[0];
  if (first) redirect(`/c/${slug}/${first.slug}`);
  return <div className="flex flex-1 items-center justify-center text-sm text-muted">No rooms yet.</div>;
}
