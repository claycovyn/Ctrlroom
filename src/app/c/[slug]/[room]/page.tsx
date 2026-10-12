import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RoomView } from "@/components/chat/RoomView";
import { loadCommunity } from "@/lib/community";
import type { BoardItem, Message, Profile, Reaction } from "@/lib/types";

const PAGE = 50;

export async function generateMetadata({ params }: { params: Promise<{ slug: string; room: string }> }): Promise<Metadata> {
  const { slug, room } = await params;
  return { title: `#${room} · ${slug}` };
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; room: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const [{ slug, room: roomSlug }, { m }] = await Promise.all([params, searchParams]);
  const { supabase, rooms, role } = await loadCommunity(slug);
  if (!role) return null;
  const room = rooms.find((r) => r.slug === roomSlug);
  if (!room) notFound();

  const [{ data: latest }, { data: board }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("room_id", room.id)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(PAGE),
    supabase.from("board_items").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(200),
  ]);
  const messages = ((latest ?? []) as Message[]).reverse();
  const ids = messages.map((x) => x.id);
  const authorIds = [...new Set([...messages.map((x) => x.author_id), ...((board ?? []) as BoardItem[]).map((b) => b.created_by)])];

  const [{ data: reactions }, { data: profiles }] = await Promise.all([
    ids.length ? supabase.from("reactions").select("message_id, user_id, emoji").in("message_id", ids) : Promise.resolve({ data: [] }),
    authorIds.length
      ? supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", authorIds)
      : Promise.resolve({ data: [] }),
  ]);

  const focus = m && /^[0-9a-f-]{36}$/i.test(m) ? m : null;

  return (
    <RoomView
      key={room.id}
      room={room}
      initialMessages={messages}
      initialReactions={(reactions ?? []) as Reaction[]}
      initialBoard={(board ?? []) as BoardItem[]}
      initialProfiles={(profiles ?? []) as Profile[]}
      hasMore={messages.length === PAGE}
      focusMessageId={focus}
    />
  );
}
