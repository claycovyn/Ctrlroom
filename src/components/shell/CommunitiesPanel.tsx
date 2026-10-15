"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { CommunityIcon } from "@/components/CommunityMedia";
import { UserPlusIcon } from "@/components/chat/icons";
import { cloudErrorText } from "@/lib/cloudErrors";
import { activityLabel, followBack, roomsActive, toExplore, type ShellCommunity } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useShell } from "./ShellContext";
import s from "./shell.module.css";

interface Explore {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  icon_url: string | null;
}
interface Follower {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  relation: string;
}

// Loaded once per visit and shared by the right column and the Communities page.
let exploreCache: Promise<Explore[]> | null = null;
let followersCache: Promise<Follower[]> | null = null;

function loadExplore(): Promise<Explore[]> {
  exploreCache ??= (async () => {
    // Public communities are readable by anyone signed in (communities_select: is_public or member).
    const { data } = await supabaseBrowser()
      .from("communities")
      .select("id, slug, name, description, icon, icon_url")
      .eq("is_public", true)
      .is("taken_down_at", null)
      .order("created_at", { ascending: false })
      .limit(24);
    return (data ?? []) as Explore[];
  })();
  return exploreCache;
}
function loadFollowers(username: string): Promise<Follower[]> {
  followersCache ??= (async () => {
    const { data } = await supabaseBrowser().rpc("profile_follows", { p_username: username, p_which: "followers", p_before: null, p_limit: 50 });
    return (data ?? []) as Follower[];
  })();
  return followersCache;
}

function Eyebrow({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[15px] font-bold tracking-tight text-fg">
      {children}
    </h2>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-panel ${className}`}>{children}</div>
  );
}

/** One of your communities: its icon, name, what's going on, and a dot when there's something new. */
function CommunityRow({ c, big = false }: { c: ShellCommunity; big?: boolean }) {
  const { activity, activityLoaded } = useShell();
  const a = activity[c.id];
  const label = activityLabel(a);
  const live = !!label;
  return (
    <li>
      <Link href={`/c/${c.slug}`} className={`group flex items-center gap-3 rounded-lg px-3 hover:bg-raised ${big ? "py-3" : "py-2"}`}>
        <CommunityIcon community={c} className={`${big ? "h-12 w-12 text-xl" : "h-10 w-10 text-lg"} rounded-xl bg-raised ring-1 ring-line`} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className={`block truncate ${live ? "font-semibold" : "font-medium"} ${big ? "text-[16px]" : "text-[15px]"}`}>{c.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {label || (activityLoaded ? (c.description || (c.is_public ? "Public community" : "Private community")) : (c.description || " "))}
          </span>
        </span>
        {c.role !== "member" && big && <span className="rounded bg-raised px-2 py-0.5 text-xs capitalize text-muted">{c.role}</span>}
        {live ? <span className={s.live} aria-hidden="true" /> : null}
        <span className="sr-only">{live ? `, ${label}` : ""}</span>
      </Link>
    </li>
  );
}

function Actions({ stacked = false }: { stacked?: boolean }) {
  const { open } = useShell();
  return (
    <div className={`grid gap-2 ${stacked ? "sm:grid-cols-2" : "grid-cols-2"}`}>
      <button type="button" className="btn-outline h-9 whitespace-nowrap px-2 text-[13px]" onClick={() => open("create")}>
        Start a community
      </button>
      <button type="button" className="btn-outline h-9 whitespace-nowrap px-2 text-[13px]" onClick={() => open("join")}>
        Join with invite
      </button>
    </div>
  );
}

function ExploreList({ limit }: { limit: number }) {
  const { communities } = useShell();
  const titleId = useId();
  const [list, setList] = useState<Explore[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadExplore().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  const shown = list ? toExplore(list, communities, limit) : [];
  if (!shown.length) return null;
  return (
    <section aria-labelledby={titleId} className="mt-6">
      <Eyebrow id={titleId}>Communities to explore</Eyebrow>
      <ul className="mt-2">
        {shown.map((c) => (
          <li key={c.id}>
            <Link href={`/c/${c.slug}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-raised">
              <CommunityIcon community={c} className="h-9 w-9 rounded-lg bg-raised text-base ring-1 ring-line" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-medium">{c.name}</span>
                <span className="block truncate text-[13px] text-muted">{c.description || "Public community"}</span>
              </span>
              <span className="text-[13px] font-medium text-fg/80">View</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Follows you": people who follow you that you don't follow back. Only shown when there are some. */
function FollowBack({ limit }: { limit: number }) {
  const { me } = useShell();
  const titleId = useId();
  const [list, setList] = useState<Follower[] | null>(null);
  const [done, setDone] = useState<Record<string, "busy" | "ok">>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!me.public_profile) return;
    let live = true;
    void loadFollowers(me.username).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [me.public_profile, me.username]);
  const shown = list ? followBack(list, me.id, limit) : [];
  if (!shown.length) return null;
  const follow = async (p: Follower) => {
    setDone((d) => ({ ...d, [p.id]: "busy" }));
    const { error: err } = await supabaseBrowser().rpc("follow_user", { p_user: p.id });
    if (err) {
      setDone((d) => {
        const next = { ...d };
        delete next[p.id];
        return next;
      });
      return setError(cloudErrorText(err.message) ?? "Couldn't follow. Try again.");
    }
    setDone((d) => ({ ...d, [p.id]: "ok" }));
  };
  return (
    <section aria-labelledby={titleId} className="mt-6">
      <Eyebrow id={titleId}>Follows you</Eyebrow>
      <ul className="mt-2">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
            <Link href={`/u/${p.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
              <Avatar profile={p} size={36} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[15px] font-medium">{p.display_name}</span>
                <span className="block truncate text-[13px] text-muted">@{p.username}</span>
              </span>
            </Link>
            <button
              type="button"
              className={`${done[p.id] === "ok" ? "btn-outline" : "btn-primary"} h-8 rounded-full px-3 text-[13px] font-semibold`}
              disabled={!!done[p.id]}
              onClick={() => follow(p)}
            >
              {done[p.id] === "ok" ? "Following" : "Follow back"}
              <span className="sr-only"> {p.display_name}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="px-3 text-sm text-alert">
          {error}
        </p>
      )}
    </section>
  );
}

function FooterLinks() {
  const { cloud } = useShell();
  return (
    <nav aria-label="About Ctrl Room" className="mt-8 flex flex-wrap gap-x-3 gap-y-1 px-1 pb-6 text-xs text-muted">
      <Link href="/docs" className="hover:text-fg hover:underline">
        Docs
      </Link>
      <Link href="/download" className="hover:text-fg hover:underline">
        Desktop app
      </Link>
      {cloud && (
        <Link href="/pricing" className="hover:text-fg hover:underline">
          Pricing
        </Link>
      )}
      <a href="/source" className="hover:text-fg hover:underline">
        Source code
      </a>
      <span>Ctrl Room by OpenCtrl</span>
    </nav>
  );
}

/** The right column: your communities as live rooms beside the feed, start or join one, and who to follow back. */
export function CommunitiesAside() {
  const { communities, activity } = useShell();
  const active = roomsActive(activity);
  const shown = communities.slice(0, 7);
  return (
    <div>
      <Panel>
        <section aria-labelledby="yours-title" className="px-2 pb-3 pt-4">
          <div className="flex items-baseline justify-between px-3">
            <Eyebrow id="yours-title">Your communities</Eyebrow>
            {active > 0 && <span className="text-xs text-muted">{active === 1 ? "1 room active" : `${active} rooms active`}</span>}
          </div>
          {communities.length ? (
            <ul className="mt-2">
              {shown.map((c) => (
                <CommunityRow key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <p className="px-3 pb-1 pt-3 text-sm text-muted">Rooms, threads and voice for your people. Start one, or join with an invite link.</p>
          )}
          {communities.length > shown.length && (
            <Link href="/app/communities" className="mx-3 mt-1 block text-sm font-medium text-fg/80 hover:underline">
              See all {communities.length}
            </Link>
          )}
          <div className="mt-3 px-3">
            <Actions />
          </div>
        </section>
      </Panel>
      <ExploreList limit={3} />
      <FollowBack limit={3} />
      <FooterLinks />
    </div>
  );
}

/** /app/communities: all of yours, start or join one, and public ones to explore. The phone tab bar's Communities. */
export function CommunitiesPage() {
  const { communities } = useShell();
  return (
    <div className="pb-6">
      <div className="border-b border-line px-4 py-4">
        <Actions stacked />
      </div>
      {communities.length ? (
        <ul className="px-1 py-2">
          {communities.map((c) => (
            <CommunityRow key={c.id} c={c} big />
          ))}
        </ul>
      ) : (
        <div className="px-6 py-12 text-center">
          <UserPlusIcon className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 font-semibold">Find your people</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
            Every community starts with #announcements, #general and a voice room. One account works for all of them.
          </p>
        </div>
      )}
      {/* From 1024px the right column already has these. */}
      <div className="px-3 lg:hidden">
        <ExploreList limit={8} />
        <FollowBack limit={5} />
      </div>
    </div>
  );
}
