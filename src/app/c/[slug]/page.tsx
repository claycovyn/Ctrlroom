import { redirect } from "next/navigation";
import { loadCommunity } from "@/lib/community";

export default async function CommunityIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await loadCommunity(slug);
  if (!role) return null;
  redirect(`/c/${slug}/feed`);
}
