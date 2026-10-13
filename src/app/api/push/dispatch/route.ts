import { NextResponse, type NextRequest } from "next/server";
import { secretMatches } from "@/lib/push";
import { dispatchPush } from "@/lib/pushServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Sends what's waiting in push_outbox (supabase/migrations/0014_push.sql).
 *   - The database calls it through pg_net right after a transaction that queued a push, with
 *     "Authorization: Bearer $PUSH_DISPATCH_SECRET".
 *   - The app calls it as a nudge after sending a message that may notify someone (signed-in users only), so pushes
 *     still go out where pg_net isn't set up.
 * Either way it only sends what the database already queued; nobody can add a notification through this route.
 */
export async function POST(request: NextRequest) {
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const bySecret = secretMatches(request.headers.get("authorization"), process.env.PUSH_DISPATCH_SECRET);
  if (!bySecret) {
    const { user } = await currentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchPush(db, { rounds: bySecret ? 5 : 1 });
    if (!result) return NextResponse.json({ ok: true, configured: false });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.warn(`[ctrlroom] push dispatch failed: ${(e as Error).message}`);
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}
