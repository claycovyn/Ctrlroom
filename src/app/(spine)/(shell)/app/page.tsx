export const dynamic = "force-dynamic";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NotConfigured } from "@/components/NotConfigured";
import { ConfirmEmailNotice } from "@/components/cloud/ConfirmEmailNotice";
import { UsageCard } from "@/components/cloud/UsageCard";
import { FeedView } from "@/components/social/FeedView";
import { loadMyCloud } from "@/lib/cloudStatus";
import { isConfigured } from "@/lib/env";
import { desktopLaunch, LAST_PLACE_COOKIE, launchTarget } from "@/lib/lastPlace";
import { loadShell } from "@/lib/shellData";
import { FEED_PAGE, isFeedScope, type PostCard } from "@/lib/social";
import { currentUser } from "@/lib/supabase/server";
import { LaunchRedirect } from "@/app/(spine)/app/LaunchRedirect";

export const metadata: Metadata = { title: "Home" };

/**
 * Home: the Feed (Following and Everyone) with the composer on top, inside the shell (your communities on the right,
 * or under Communities on a phone). The Home Screen and desktop apps still open straight to where you were.
 */
export default async function AppHome({ searchParams }: { searchParams: Promise<{ done?: string; launch?: string; tab?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { done, launch, tab } = await searchParams;
  // Opening the Home Screen app on a phone: straight back to the last room, before rendering the feed (the room
  // checks you're signed in and a member). LaunchRedirect still covers a browser without the cookie.
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const target = launchTarget({ launch, userAgent: head.get("user-agent"), cookie: jar.get(LAST_PLACE_COOKIE)?.value });
  if (target) redirect(target);
  const { supabase, user } = await currentUser();
  if (!user) redirect(launch === "desktop" ? `/login?next=${encodeURIComponent("/app?launch=desktop")}` : "/login");
  const scope = isFeedScope(tab) ? tab : "following";

  const [shell, { data: posts }, { data: follows }, { data: communityFollows }, cloud] = await Promise.all([
    loadShell(),
    supabase.rpc("feed_posts", { p_scope: scope, p_before: null, p_limit: FEED_PAGE }),
    supabase.from("follows").select("followee_id").eq("follower_id", user.id).eq("status", "active"),
    supabase.from("community_follows").select("community_id").eq("user_id", user.id),
    loadMyCloud(supabase),
  ]);
  if (!shell) redirect("/login");
  // The desktop app opens here: straight to your community, or your messages when you're in more than one.
  if (launch === "desktop") {
    const to = desktopLaunch({ communitySlugs: shell.communities.map((c) => c.slug), cookie: jar.get(LAST_PLACE_COOKIE)?.value });
    if (to) redirect(to);
  }
  // The full usage card lives in Settings; Home shows it only when something is near or over a limit.
  const usageNotice = cloud && cloud.owns > 0 && cloud.status.meters.some((m) => m.limit !== null && m.limit > 0 && m.state !== "ok");

  return (
    <>
      <LaunchRedirect />
      <FeedView
        key={scope}
        me={shell.me}
        scope={scope}
        initial={(posts ?? []) as PostCard[]}
        following={(follows ?? []).map((f) => f.followee_id as string)}
        followedCommunities={(communityFollows ?? []).map((c) => c.community_id as string)}
        notices={
          done === "password" || (cloud?.enabled && !cloud.emailConfirmed && user.email) || usageNotice ? (
            <div className="space-y-3 border-b border-line p-4">
              {done === "password" && (
                <p role="status" className="card px-4 py-3 text-sm">
                  Password saved. You&apos;re signed in.
                </p>
              )}
              {cloud?.enabled && !cloud.emailConfirmed && user.email && <ConfirmEmailNotice email={user.email} />}
              {usageNotice && cloud && <UsageCard cloud={cloud} />}
            </div>
          ) : null
        }
      />
    </>
  );
}
