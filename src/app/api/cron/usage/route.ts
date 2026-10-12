import { NextResponse, type NextRequest } from "next/server";
import { sendUsageNotices, type OverviewRow } from "@/lib/notices";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Daily usage check (vercel.json cron): emails the 80% and 100% notices. Vercel sends
 * "Authorization: Bearer $CRON_SECRET"; without CRON_SECRET set the route refuses to run.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  const [{ data: config }, { data: rows, error }] = await Promise.all([
    db.from("cloud_config").select("enabled").eq("id", 1).single(),
    db.rpc("cloud_admin_overview"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sent = await sendUsageNotices(db, (rows ?? []) as OverviewRow[], Boolean(config?.enabled));
  return NextResponse.json({ ok: true, workspaces: (rows ?? []).length, sent });
}
