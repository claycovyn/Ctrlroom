import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DmConversationPage } from "@/components/dm/DmPages";
import { loadCommunity } from "@/lib/community";

export const metadata: Metadata = { title: "Direct messages" };

// Messages load in the browser with the person's own session; row-level security (0011) decides what they see.
export default async function DmConversationRoute({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { role } = await loadCommunity(slug);
  if (!role) return null;
  return <DmConversationPage id={id} />;
}
