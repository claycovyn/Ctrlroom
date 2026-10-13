import type { Metadata } from "next";
import { DmInboxPage } from "@/components/dm/DmPages";
import { loadCommunity } from "@/lib/community";

export const metadata: Metadata = { title: "Direct messages" };

export default async function DmInboxRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await loadCommunity(slug);
  if (!role) return null;
  return <DmInboxPage />;
}
