export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { UsageCard } from "@/components/cloud/UsageCard";
import { SettingsPage } from "@/components/shell/SettingsPage";
import { loadMyCloud } from "@/lib/cloudStatus";
import { isConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

/** Your own settings (photo, name, notifications, sounds, messages, account). Each community keeps its own. */
export default async function Settings() {
  if (!isConfigured()) return <NotConfigured />;
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/app/settings")}`);
  const cloud = await loadMyCloud(supabase);
  return <SettingsPage email={user.email ?? null} usage={cloud && cloud.owns > 0 ? <UsageCard cloud={cloud} /> : null} />;
}
