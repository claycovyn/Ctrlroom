import type { Metadata } from "next";
import { SettingsView } from "@/components/chat/SettingsView";
import { ConfirmEmailNotice } from "@/components/cloud/ConfirmEmailNotice";
import { UsageCard } from "@/components/cloud/UsageCard";
import { loadMyCloud } from "@/lib/cloudStatus";
import { siteUrl } from "@/lib/env";
import { loadCommunity } from "@/lib/community";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role, supabase, user } = await loadCommunity(slug);
  if (!role) return null;
  // Usage is the owner's (it counts across every community they own); admins still get export.
  const cloud = role === "owner" ? await loadMyCloud(supabase) : null;
  const canExport = role === "owner" || role === "admin";
  return (
    <SettingsView
      siteUrl={siteUrl()}
      exportHref={canExport ? `/api/c/${slug}/export` : null}
      cloudPanel={
        cloud ? (
          <>
            {cloud.enabled && !cloud.emailConfirmed && user.email && <ConfirmEmailNotice email={user.email} />}
            <UsageCard cloud={cloud} />
          </>
        ) : null
      }
    />
  );
}
