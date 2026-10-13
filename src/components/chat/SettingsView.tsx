"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { slugify } from "@/lib/format";
import { CommunityImages } from "@/components/CommunityImages";
import { ProfilePhoto } from "@/components/ProfilePhoto";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, ROLE_RANK, type Profile, type Role, type Room } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useCommunity } from "./CommunityContext";
import { MenuIcon, TrashIcon } from "./icons";

interface Invite {
  code: string;
  uses: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string;
}

interface MemberRow {
  user_id: string;
  role: Role;
  profiles: Profile;
}

interface BanRow {
  user_id: string;
  reason: string;
  profiles: Profile | null;
}

export function SettingsView({
  siteUrl,
  exportHref = null,
  cloudPanel = null,
}: {
  siteUrl: string;
  /** Full JSON export (owners and admins). Works on every plan and over every limit. */
  exportHref?: string | null;
  /** Plan, usage and email confirmation for the owner (rendered on the server). */
  cloudPanel?: React.ReactNode;
}) {
  const { me, role, community, rooms, setRooms, setNavOpen, addProfiles } = useCommunity();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const isMod = atLeast(role, "mod");
  const isAdmin = atLeast(role, "admin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const say = (msg: string, bad = false) => {
    (bad ? setError : setNotice)(msg);
    setTimeout(() => (bad ? setError(null) : setNotice(null)), 4000);
  };

  // ── invites
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("7");
  const loadInvites = useCallback(async () => {
    if (!isMod) return;
    const { data } = await supabase.from("invites").select("*").eq("community_id", community.id).order("created_at", { ascending: false });
    setInvites((data ?? []) as Invite[]);
  }, [isMod, supabase, community.id]);

  // ── members
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [filter, setFilter] = useState("");
  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from("community_members")
      .select("user_id, role, profiles(id, username, display_name, avatar_url, is_bot)")
      .eq("community_id", community.id)
      .order("joined_at")
      .limit(1000);
    setMembers(((data ?? []) as unknown as MemberRow[]).filter((m) => m.profiles));
    if (isMod) {
      const { data: b } = await supabase.from("bans").select("user_id, reason, profiles!bans_user_id_fkey(id, username, display_name, avatar_url, is_bot)").eq("community_id", community.id);
      setBans((b ?? []) as unknown as BanRow[]);
    }
  }, [supabase, community.id, isMod]);

  useEffect(() => {
    loadInvites();
    loadMembers();
  }, [loadInvites, loadMembers]);

  // ── community details
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [icon, setIcon] = useState(community.icon);
  const [isPublic, setIsPublic] = useState(community.is_public);

  // ── new room
  const [roomName, setRoomName] = useState("");
  const [roomKind, setRoomKind] = useState<Room["kind"]>("text");
  const [roomTopic, setRoomTopic] = useState("");
  const [announce, setAnnounce] = useState(false);

  const myRank = role ? ROLE_RANK[role] : 0;
  const shownMembers = members.filter(
    (m) => !filter || m.profiles.username.includes(filter.toLowerCase()) || m.profiles.display_name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
          <MenuIcon className="h-5 w-5" />
        </button>
        <h1 className="font-semibold">Settings · {community.name}</h1>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
          {(error || notice) && (
            <p role="status" className={`rounded-md px-3 py-2 text-sm ${error ? "bg-alert/15 text-alert" : "bg-signal/15"}`}>
              {error ?? notice}
            </p>
          )}

          {cloudPanel}

          <section id="profile" className="card p-5">
            <h2 className="font-medium">Profile photo</h2>
            <p className="mb-4 text-sm text-muted">Shows next to your name in every community.</p>
            <ProfilePhoto profile={me} onChange={(url) => addProfiles([{ ...me, avatar_url: url }])} />
          </section>

          {isMod && (
            <section id="invites" className="card p-5">
              <h2 className="font-medium">Invite people</h2>
              <p className="mb-4 text-sm text-muted">Anyone with the link can join until it expires or runs out of uses.</p>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const days = Number(expires);
                  const { error: err } = await supabase.from("invites").insert({
                    community_id: community.id,
                    created_by: me.id,
                    max_uses: maxUses ? Number(maxUses) : null,
                    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
                  });
                  if (err) return say("Couldn't create the invite.", true);
                  loadInvites();
                }}
              >
                <div>
                  <label className="label" htmlFor="uses">
                    Uses
                  </label>
                  <select id="uses" className="input w-36" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
                    <option value="">No limit</option>
                    <option value="1">1 person</option>
                    <option value="5">5 people</option>
                    <option value="25">25 people</option>
                    <option value="100">100 people</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="expires">
                    Expires
                  </label>
                  <select id="expires" className="input w-36" value={expires} onChange={(e) => setExpires(e.target.value)}>
                    <option value="1">In a day</option>
                    <option value="7">In a week</option>
                    <option value="30">In 30 days</option>
                    <option value="0">Never</option>
                  </select>
                </div>
                <button className="btn-primary">Create invite link</button>
              </form>
              {invites.length > 0 && (
                <ul className="mt-4 divide-y divide-line rounded-md border border-line">
                  {invites.map((i) => {
                    const link = `${siteUrl}/invite/${i.code}`;
                    const dead = (i.expires_at && new Date(i.expires_at) < new Date()) || (i.max_uses !== null && i.uses >= i.max_uses);
                    return (
                      <li key={i.code} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${dead ? "opacity-50" : ""}`}>
                        <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
                        <span className="text-xs text-muted">
                          {i.uses}
                          {i.max_uses ? `/${i.max_uses}` : ""} used
                          {i.expires_at && ` · ${dead ? "expired" : `until ${new Date(i.expires_at).toLocaleDateString()}`}`}
                        </span>
                        <button
                          className="btn-outline py-1 text-xs"
                          onClick={async () => {
                            await navigator.clipboard.writeText(link);
                            say("Invite link copied.");
                          }}
                        >
                          Copy
                        </button>
                        <button
                          className="rounded p-1 text-muted hover:text-alert"
                          aria-label="Revoke invite"
                          onClick={async () => {
                            await supabase.from("invites").delete().eq("code", i.code);
                            loadInvites();
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {isAdmin && (
            <section id="rooms" className="card p-5">
              <h2 className="font-medium">Rooms</h2>
              <p className="mb-4 text-sm text-muted">Text rooms for chat. Voice rooms open a call when you walk in.</p>
              <form
                className="grid gap-3 sm:grid-cols-[1fr_8rem]"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const slug = slugify(roomName, 32);
                  if (!slug) return say("Give the room a name.", true);
                  const { data, error: err } = await supabase
                    .from("rooms")
                    .insert({
                      community_id: community.id,
                      slug,
                      name: slug,
                      topic: roomTopic.trim(),
                      kind: roomKind,
                      post_min_role: announce ? "mod" : "member",
                      position: rooms.length,
                    })
                    .select()
                    .single();
                  if (err) return say(err.code === "23505" ? `#${slug} already exists.` : "Couldn't add the room.", true);
                  setRooms((list) => [...list.filter((r) => r.id !== (data as Room).id), data as Room]);
                  setRoomName("");
                  setRoomTopic("");
                  setAnnounce(false);
                  say(`#${slug} added.`);
                }}
              >
                <input className="input" placeholder="room-name" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={32} required />
                <select className="input" value={roomKind} onChange={(e) => setRoomKind(e.target.value as Room["kind"])} aria-label="Room type">
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                </select>
                <input className="input sm:col-span-2" placeholder="Topic (optional)" value={roomTopic} onChange={(e) => setRoomTopic(e.target.value)} maxLength={280} />
                <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
                  <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announcements only (mods post, everyone can reply in threads)
                </label>
                <button className="btn-primary sm:col-span-2 sm:justify-self-start">Add room</button>
              </form>
              <ul className="mt-4 divide-y divide-line rounded-md border border-line">
                {rooms.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-medium">
                      {r.kind === "voice" ? "🔊 " : "#"}
                      {r.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted">{r.topic}</span>
                    {r.post_min_role !== "member" && <span className="rounded bg-raised px-1.5 text-xs text-muted">announcements</span>}
                    <button
                      className="rounded p-1 text-muted hover:text-alert"
                      aria-label={`Delete ${r.name}`}
                      onClick={async () => {
                        if (!confirm(`Delete #${r.name} and all its messages? This can't be undone.`)) return;
                        const { error: err } = await supabase.from("rooms").delete().eq("id", r.id);
                        if (err) return say("Couldn't delete the room.", true);
                        setRooms((list) => list.filter((x) => x.id !== r.id));
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="people" className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">People · {members.length}</h2>
              <input className="input w-48" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <ul className="divide-y divide-line">
              {shownMembers.map((m) => {
                const theirs = ROLE_RANK[m.role];
                const manageable = m.user_id !== me.id && myRank > theirs;
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2">
                    <Avatar profile={m.profiles} size={30} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-sm font-medium">{m.profiles.display_name}</div>
                      <div className="truncate text-xs text-muted">@{m.profiles.username}</div>
                    </div>
                    {isAdmin && manageable ? (
                      <select
                        className="input w-28 py-1 text-xs"
                        value={m.role}
                        aria-label={`Role for ${m.profiles.display_name}`}
                        onChange={async (e) => {
                          const { error: err } = await supabase.rpc("set_member_role", {
                            p_community: community.id,
                            p_user: m.user_id,
                            p_role: e.target.value,
                          });
                          if (err) return say("You can't change that role.", true);
                          loadMembers();
                        }}
                      >
                        {(["admin", "mod", "member"] as Role[])
                          .filter((r) => ROLE_RANK[r] < myRank)
                          .map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="rounded bg-raised px-2 py-0.5 text-xs capitalize text-muted">{m.role}</span>
                    )}
                    {isMod && manageable && (
                      <>
                        <button
                          className="btn-ghost py-1 text-xs"
                          onClick={async () => {
                            if (!confirm(`Remove ${m.profiles.display_name}? They can rejoin with an invite.`)) return;
                            const { error: err } = await supabase.rpc("remove_member", { p_community: community.id, p_user: m.user_id });
                            if (err) return say("Couldn't remove them.", true);
                            loadMembers();
                          }}
                        >
                          Remove
                        </button>
                        <button
                          className="btn-ghost py-1 text-xs text-alert"
                          onClick={async () => {
                            const reason = prompt(`Ban ${m.profiles.display_name}? Add a reason (only mods see it).`);
                            if (reason === null) return;
                            const { error: err } = await supabase.rpc("remove_member", {
                              p_community: community.id,
                              p_user: m.user_id,
                              p_ban: true,
                              p_reason: reason,
                            });
                            if (err) return say("Couldn't ban them.", true);
                            loadMembers();
                          }}
                        >
                          Ban
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {isMod && bans.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">Banned</h3>
                <ul className="divide-y divide-line">
                  {bans.map((b) => (
                    <li key={b.user_id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex-1">
                        {b.profiles?.display_name ?? "Former member"}
                        {b.reason && <span className="text-muted"> · {b.reason}</span>}
                      </span>
                      <button
                        className="btn-ghost py-1 text-xs"
                        onClick={async () => {
                          await supabase.rpc("unban_member", { p_community: community.id, p_user: b.user_id });
                          loadMembers();
                        }}
                      >
                        Unban
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {isAdmin && (
            <section className="card p-5">
              <h2 className="mb-4 font-medium">Community</h2>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const { error: err } = await supabase
                    .from("communities")
                    .update({ name: name.trim(), description: description.trim(), icon: icon.trim(), is_public: isPublic })
                    .eq("id", community.id);
                  if (err) return say(cloudErrorText(err.message) ?? "Couldn't save.", true);
                  say("Saved.");
                  router.refresh();
                }}
              >
                <div className="grid grid-cols-[4rem_1fr] gap-3">
                  <input className="input text-center" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} aria-label="Icon" />
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={64} aria-label="Name" required />
                </div>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} placeholder="What's it for?" aria-label="Description" />
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                  Public: anyone signed in with the link /c/{community.slug} can join without an invite
                </label>
                <button className="btn-primary">Save</button>
              </form>
            </section>
          )}

          {isAdmin && (
            <section id="images" className="card p-5">
              <h2 className="mb-4 font-medium">Images</h2>
              <CommunityImages community={community} />
            </section>
          )}

          {exportHref && (
            <section className="card p-5">
              <h2 className="font-medium">Export</h2>
              <p className="mb-3 text-sm text-muted">
                Everything in {community.name} as one JSON file: rooms, every message and thread, the boards and members.
              </p>
              <a href={exportHref} className="btn-outline inline-flex" download>
                Download export
              </a>
            </section>
          )}

          {role !== "owner" && (
            <section className="card p-5">
              <h2 className="font-medium">Leave {community.name}</h2>
              <p className="mb-3 text-sm text-muted">You’ll need a new invite to come back.</p>
              <button
                className="btn-outline text-alert"
                onClick={async () => {
                  if (!confirm(`Leave ${community.name}?`)) return;
                  const { error: err } = await supabase.rpc("leave_community", { p_community: community.id });
                  if (err) return say("Couldn't leave.", true);
                  router.push("/app");
                }}
              >
                Leave community
              </button>
            </section>
          )}

          <p className="pb-6 text-center text-xs text-muted">
            <Link href={`/c/${community.slug}`} className="hover:text-fg">
              ← Back to the rooms
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
