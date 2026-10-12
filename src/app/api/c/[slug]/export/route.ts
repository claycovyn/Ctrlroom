import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;

/**
 * Full export of a community as JSON: rooms, every message and thread reply (deleted ones as tombstones), board,
 * members. Owners and admins only. Works on every plan, over every limit and after a takedown: usage never
 * locks anyone out of their own history. Reads go through row-level security with the caller's session.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { data: community } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
  if (!community) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: me } = await supabase.from("community_members").select("role").eq("community_id", community.id).eq("user_id", user.id).maybeSingle();
  if (!me || !["owner", "admin"].includes(me.role)) return NextResponse.json({ error: "Only owners and admins can export." }, { status: 403 });

  const all = async (table: string, columns: string, order: string) => {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).eq("community_id", community.id)
        .order(order).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < PAGE) return out;
    }
  };

  try {
    const [rooms, messages, board] = await Promise.all([
      all("rooms", "id, slug, name, topic, kind, post_min_role, position, created_at", "position"),
      all("messages", "id, room_id, parent_id, author_id, body, reply_count, resolved_at, outcome, edited_at, deleted_at, created_at", "created_at"),
      all("board_items", "id, room_id, kind, title, url, body, message_id, created_by, created_at", "created_at"),
    ]);
    const { data: members } = await supabase
      .from("community_members")
      .select("user_id, role, joined_at, profiles(username, display_name)")
      .eq("community_id", community.id);
    const body = {
      format: "ctrlroom-export",
      version: 1,
      exported_at: new Date().toISOString(),
      community: { id: community.id, slug: community.slug, name: community.name, description: community.description, icon: community.icon, is_public: community.is_public, created_at: community.created_at },
      rooms,
      members: members ?? [],
      messages,
      board,
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="ctrlroom-${community.slug}-${body.exported_at.slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export failed. Try again." }, { status: 500 });
  }
}
