import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMUNITY_SLUG, DM_PREFIX, OPENCTRL_BOT_ID, ROOM_SLUG, type InviteStore, type Reactor, type WhoCanDm } from "./shiftInvites";

/**
 * The Shift invite run's reads and writes (src/lib/shiftInvites.ts), with the service role: this is bot work (the
 * OpenCtrl account sending a DM someone asked for by reacting), like the AI helpers' replies. No migration; it uses
 * the tables as they are:
 *   - The pinned post: a board item (0001 board_items, "Pin to board") in #waitlist of `openctrl` that points at a
 *     live message, added by a mod or above (anyone in the room can add to the board, so other pins don't count).
 *     The newest one wins. CTRLROOM_SHIFT_INVITE_MESSAGE_ID names the message instead (it must be in `openctrl`).
 *   - Reactions (0001 reactions), members, bans, profiles.is_bot (0002), dm_settings and blocks (0011).
 *   - The DM goes in the person's 1:1 with the OpenCtrl account (0011 dm_conversations.pair_key), with both as
 *     active members: reacting was the request, so it lands in their inbox rather than in Requests. The 0011 triggers
 *     still run (blocks, the flood guard, realtime), and so does 0014's push.
 */
export function supabaseInviteStore(db: SupabaseClient, o: { messageId?: string | null } = {}): InviteStore {
  let communityId: string | null | undefined;
  const community = async () => {
    if (communityId === undefined) {
      const { data, error } = await db.from("communities").select("id").eq("slug", COMMUNITY_SLUG).maybeSingle();
      if (error) throw new Error(error.message);
      communityId = (data?.id as string | undefined) ?? null;
    }
    return communityId;
  };

  const liveMessage = async (id: string, cid: string) => {
    const { data, error } = await db.from("messages").select("id, community_id, deleted_at").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data && data.community_id === cid && !data.deleted_at ? (data.id as string) : null;
  };

  /** All rows of a query, 1,000 at a time. */
  async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await page(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return out;
    }
  }

  const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  return {
    async inviteMessage() {
      const cid = await community();
      if (!cid) return null;
      if (o.messageId) return liveMessage(o.messageId, cid);
      const { data: room, error: roomErr } = await db.from("rooms").select("id").eq("community_id", cid).eq("slug", ROOM_SLUG).maybeSingle();
      if (roomErr) throw new Error(roomErr.message);
      if (!room) return null;
      const { data: pins, error } = await db
        .from("board_items")
        .select("message_id, created_by")
        .eq("room_id", room.id)
        .not("message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      if (!pins?.length) return null;
      const { data: staff } = await db
        .from("community_members")
        .select("user_id")
        .eq("community_id", cid)
        .in("role", ["owner", "admin", "mod"])
        .in("user_id", [...new Set(pins.map((p) => p.created_by as string))]);
      const mods = new Set((staff ?? []).map((s) => s.user_id as string));
      for (const p of pins) {
        if (!mods.has(p.created_by as string)) continue;
        const id = await liveMessage(p.message_id as string, cid);
        if (id) return id;
      }
      return null;
    },

    async reactorIds(messageId) {
      const rows = await all<{ user_id: string }>((from, to) =>
        db.from("reactions").select("user_id").eq("message_id", messageId).order("created_at", { ascending: true }).order("user_id").range(from, to),
      );
      return [...new Set(rows.map((r) => r.user_id))];
    },

    async deliveredTo() {
      const rows = await all<{ conversation_id: string; dm_conversations: { pair_key: string | null } | { pair_key: string | null }[] | null }>((from, to) =>
        db
          .from("dm_messages")
          .select("conversation_id, dm_conversations!inner(pair_key)")
          .eq("author_id", OPENCTRL_BOT_ID)
          .like("body", `${DM_PREFIX}%`)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to),
      );
      const out = new Set<string>();
      for (const r of rows) {
        const conv = Array.isArray(r.dm_conversations) ? r.dm_conversations[0] : r.dm_conversations;
        for (const id of conv?.pair_key?.split(":") ?? []) if (id !== OPENCTRL_BOT_ID) out.add(id);
      }
      return out;
    },

    async reactors(ids) {
      const cid = await community();
      if (!cid || !ids.length) return [];
      const out: Reactor[] = [];
      for (const part of chunks(ids)) {
        const [profiles, members, bans, settings, blocks] = await Promise.all([
          db.from("profiles").select("id, is_bot").in("id", part),
          db.from("community_members").select("user_id").eq("community_id", cid).in("user_id", part),
          db.from("bans").select("user_id").eq("community_id", cid).in("user_id", part),
          db.from("dm_settings").select("user_id, who_can_dm").in("user_id", part),
          db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${OPENCTRL_BOT_ID},blocked_id.eq.${OPENCTRL_BOT_ID}`),
        ]);
        for (const r of [profiles, members, bans, settings, blocks]) if (r.error) throw new Error(r.error.message);
        const member = new Set((members.data ?? []).map((m) => m.user_id as string));
        const banned = new Set((bans.data ?? []).map((b) => b.user_id as string));
        const who = new Map((settings.data ?? []).map((s) => [s.user_id as string, s.who_can_dm as WhoCanDm]));
        const blocked = new Set((blocks.data ?? []).flatMap((b) => [b.blocker_id as string, b.blocked_id as string]));
        for (const p of profiles.data ?? []) {
          const id = p.id as string;
          out.push({ id, isBot: Boolean(p.is_bot), member: member.has(id), banned: banned.has(id), whoCanDm: who.get(id) ?? "shared_community", blocked: blocked.has(id) });
        }
      }
      return out;
    },

    async emailConfirmed(id) {
      const { data, error } = await db.auth.admin.getUserById(id);
      if (error || !data?.user) return false;
      return Boolean(data.user.email && data.user.email_confirmed_at);
    },

    async sendDm(userId, body) {
      const key = [OPENCTRL_BOT_ID, userId].sort().join(":");
      const reversed = key.split(":").reverse().join(":");
      const find = async () => {
        const { data, error } = await db.from("dm_conversations").select("id").in("pair_key", [key, reversed]).maybeSingle();
        if (error) throw new Error(error.message);
        return (data?.id as string | undefined) ?? null;
      };
      let conv = await find();
      if (!conv) {
        const { data, error } = await db.from("dm_conversations").insert({ is_group: false, pair_key: key, created_by: OPENCTRL_BOT_ID }).select("id").single();
        if (error && error.code !== "23505") throw new Error(error.message);
        conv = (data?.id as string | undefined) ?? (await find());
        if (!conv) throw new Error("conversation not found");
      }
      const { error: memErr } = await db.from("dm_members").upsert(
        [
          { conversation_id: conv, user_id: OPENCTRL_BOT_ID, status: "active", added_by: OPENCTRL_BOT_ID },
          { conversation_id: conv, user_id: userId, status: "active", added_by: OPENCTRL_BOT_ID },
        ],
        { onConflict: "conversation_id,user_id" },
      );
      if (memErr) throw new Error(memErr.message);
      const { error } = await db.from("dm_messages").insert({ conversation_id: conv, author_id: OPENCTRL_BOT_ID, body });
      if (error) throw new Error(error.message);
    },
  };
}
