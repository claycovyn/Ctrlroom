export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotConfigured } from "@/components/NotConfigured";
import { ActivityView, type ActivityItem } from "@/components/social/ActivityView";
import { SocialHeader } from "@/components/social/SocialHeader";
import { isConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity" };

/** New followers and requests, and likes and replies on your posts, newest first. */
export default async function Activity() {
  if (!isConfigured()) return <NotConfigured />;
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/app/feed/activity")}`);
  const [{ data: me }, { data: items }] = await Promise.all([
    supabase.from("profiles").select("id, username").eq("id", user.id).single(),
    supabase.rpc("my_activity", { p_limit: 50 }),
  ]);
  if (!me) redirect("/app");
  return (
    <>
      <SocialHeader me={me} current="activity" />
      <ActivityView me={me} items={(items ?? []) as ActivityItem[]} />
    </>
  );
}
