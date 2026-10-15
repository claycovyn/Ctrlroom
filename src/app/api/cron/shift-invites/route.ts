import { NextResponse, type NextRequest } from "next/server";
import { dispatchPush } from "@/lib/pushServer";
import { DEFAULT_SHIFT_ISSUE_URL, runShiftInvites, shiftClient } from "@/lib/shiftInvites";
import { supabaseInviteStore } from "@/lib/shiftInviteStore";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every 5 minutes (vercel.json): OpenCtrl Shift invites for people who reacted to the pinned post in #waitlist of the
 * `openctrl` community (src/lib/shiftInvites.ts explains the rules). Vercel sends "Authorization: Bearer $CRON_SECRET";
 * without CRON_SECRET set the route refuses to run. Off until SHIFT_CTRLROOM_SECRET is set (the same value as Shift's).
 * The answer has counts only, never who.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shared = process.env.SHIFT_CTRLROOM_SECRET;
  if (!shared || shared.length < 32) return NextResponse.json({ ok: true, configured: false });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  try {
    const store = supabaseInviteStore(db, { messageId: process.env.CTRLROOM_SHIFT_INVITE_MESSAGE_ID?.trim() || null });
    const shift = shiftClient({ url: process.env.SHIFT_ISSUE_URL?.trim() || DEFAULT_SHIFT_ISSUE_URL, secret: shared });
    const result = await runShiftInvites(store, shift);
    // The DMs queued pushes (0014); send them now in case pg_net isn't set up. A push problem doesn't fail the run.
    if (result.sent + result.resent > 0) await dispatchPush(db, { rounds: 1 }).catch(() => null);
    return NextResponse.json({ ok: true, ...result, message: result.message ? "found" : "none" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.warn(`[ctrlroom] shift invites failed: ${(e as Error).message}`);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}
