export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { CommunitiesPage } from "@/components/shell/CommunitiesPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import { isConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Communities" };

/** All your communities, start or join one, and public ones to explore (the right column, full width). */
export default async function Communities() {
  if (!isConfigured()) return <NotConfigured />;
  const { user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/app/communities")}`);
  return (
    <>
      <PageHeader title="Communities" sub="Rooms, threads and voice" />
      <CommunitiesPage />
    </>
  );
}
