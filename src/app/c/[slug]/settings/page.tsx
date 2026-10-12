import type { Metadata } from "next";
import { SettingsView } from "@/components/chat/SettingsView";
import { siteUrl } from "@/lib/env";
import { loadCommunity } from "@/lib/community";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await loadCommunity(slug);
  if (!role) return null;
  return <SettingsView siteUrl={siteUrl()} />;
}
