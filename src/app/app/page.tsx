export const dynamic = "force-dynamic";

import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CommunityIcon } from "@/components/CommunityMedia";
import { Logo } from "@/components/Logo";
import { NotConfigured } from "@/components/NotConfigured";
import { ProfilePhoto } from "@/components/ProfilePhoto";
import { ConfirmEmailNotice } from "@/components/cloud/ConfirmEmailNotice";
import { UsageCard } from "@/components/cloud/UsageCard";
import { cloudEnabled } from "@/lib/cloud";
import { loadMyCloud } from "@/lib/cloudStatus";
import { isConfigured } from "@/lib/env";
import { LAST_PLACE_COOKIE, launchTarget } from "@/lib/lastPlace";
import { currentUser } from "@/lib/supabase/server";
import type { Community, Profile, Role } from "@/lib/types";
import { CreateCommunityForm, JoinCommunityForm } from "./HomeForms";
import { LaunchRedirect } from "./LaunchRedirect";

export const metadata: Metadata = { title: "Your communities" };

export default async function AppHome({ searchParams }: { searchParams: Promise<{ done?: string; launch?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { done, launch } = await searchParams;
  // Opening the Home Screen app on a phone: straight back to the last room, before rendering this list (the room
  // checks you're signed in and a member). LaunchRedirect still covers a browser without the cookie.
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const target = launchTarget({ launch, userAgent: head.get("user-agent"), cookie: jar.get(LAST_PLACE_COOKIE)?.value });
  if (target) redirect(target);
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const [{ data: memberships }, { data: profile }, cloud] = await Promise.all([
    supabase
      .from("community_members")
      .select("role, communities(*)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true }),
    supabase.from("profiles").select("id, username, display_name, avatar_url, is_bot").eq("id", user.id).single(),
    loadMyCloud(supabase),
  ]);
  const communities = ((memberships ?? []) as unknown as { role: Role; communities: Community }[]).filter(
    (m) => m.communities,
  );

  return (
    <main className="min-h-screen">
      <LaunchRedirect />
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/app/dm" className="btn-ghost">
            Messages
          </Link>
          <span className="text-muted">@{profile?.username}</span>
          <form action="/auth/signout" method="post">
            <button className="btn-ghost">Sign out</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <h1 className="mb-6 mt-4 text-2xl font-semibold">
          {communities.length ? `Hey ${profile?.display_name ?? ""}` : "Find your people"}
        </h1>

        {done === "password" && (
          <p role="status" className="card mb-6 px-4 py-3 text-sm">
            Password saved. You&apos;re signed in.
          </p>
        )}
        {cloud?.enabled && !cloud.emailConfirmed && user.email && (
          <div className="mb-6">
            <ConfirmEmailNotice email={user.email} />
          </div>
        )}
        {cloud && cloud.owns > 0 && (
          <div className="mb-6">
            <UsageCard cloud={cloud} />
          </div>
        )}

        {communities.length > 0 && (
          <ul className="mb-10 grid gap-3 sm:grid-cols-2">
            {communities.map(({ communities: c, role }) => (
              <li key={c.id}>
                <Link
                  href={`/c/${c.slug}`}
                  className="card flex items-center gap-4 p-4 transition-colors hover:border-signal"
                >
                  <CommunityIcon community={c} className="h-12 w-12 rounded-xl bg-raised text-xl" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-sm text-muted">{c.description || `/c/${c.slug}`}</span>
                  </span>
                  {role !== "member" && (
                    <span className="ml-auto rounded bg-raised px-2 py-0.5 text-xs capitalize text-muted">{role}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="card p-5">
            <h2 className="mb-1 font-medium">Start a community</h2>
            <p className="mb-4 text-sm text-muted">
              You’ll start with #announcements, #general and a voice lounge. You can change them later.
            </p>
            <CreateCommunityForm />
          </section>
          <section className="card p-5">
            <h2 className="mb-1 font-medium">Join with an invite</h2>
            <p className="mb-4 text-sm text-muted">Paste the link someone sent you.</p>
            <JoinCommunityForm />
          </section>
        </div>
        {profile && (
          <section id="profile" className="card mt-6 p-5">
            <h2 className="mb-1 font-medium">Profile photo</h2>
            <p className="mb-4 text-sm text-muted">Shows next to your name in every community.</p>
            <ProfilePhoto profile={profile as Profile} />
          </section>
        )}
        <p className="mt-10 text-center text-xs text-muted">
          {cloudEnabled() && (
            <>
              <Link href="/pricing" className="hover:text-fg">
                Pricing
              </Link>{" "}
              ·{" "}
            </>
          )}
          <a href="/source" className="hover:text-fg">
            Source code
          </a>
        </p>
      </div>
    </main>
  );
}
