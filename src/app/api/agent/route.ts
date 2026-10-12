import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runJob, type BotJob } from "@/lib/agent/run";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.union([z.object({ messageId: z.string().uuid() }), z.object({ roomId: z.string().uuid() })]);

/**
 * Starts the @ctrl / @openctrl jobs that a message created. Jobs themselves come from a
 * database trigger, so this can only run answers for real messages. Called by the sender
 * right after posting, and by anyone in the room to pick up jobs that never started.
 */
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "AI helpers aren't set up on this server." }, { status: 503 });

  // Visibility check with the caller's own permissions (row-level security).
  let claim = admin.from("bot_jobs").update({ status: "running", step: "Thinking…" }).eq("status", "queued");
  let claimLimited = admin.from("bot_jobs").update({ status: "running", step: "" }).eq("status", "limited").is("reply_id", null);
  if ("messageId" in parsed.data) {
    const { data: msg } = await supabase.from("messages").select("id, author_id").eq("id", parsed.data.messageId).maybeSingle();
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
    claim = claim.eq("message_id", msg.id);
    claimLimited = claimLimited.eq("message_id", msg.id).eq("requested_by", user.id);
  } else {
    const { data: room } = await supabase.from("rooms").select("id").eq("id", parsed.data.roomId).maybeSingle();
    if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Only stale jobs, so this never races the sender's own request.
    const stale = new Date(Date.now() - 15_000).toISOString();
    claim = claim.eq("room_id", room.id).lt("created_at", stale);
    claimLimited = claimLimited.eq("room_id", room.id).lt("created_at", stale);
  }

  const [{ data: jobs }, { data: limited }] = await Promise.all([claim.select("*").limit(5), claimLimited.select("*").limit(5)]);
  const claimed = [
    ...((jobs ?? []) as BotJob[]),
    ...((limited ?? []) as BotJob[]).map((j) => ({ ...j, status: "limited" })),
  ];
  after(() => Promise.all(claimed.map((j) => runJob(admin, j))));
  return NextResponse.json({ started: claimed.map((j) => ({ id: j.id, bot: j.bot })) }, { status: 202 });
}
