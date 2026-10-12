import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { noticeFor, workspaceStatus, type CloudStatusRow } from "@/lib/cloud";
import { sendEmail } from "@/lib/email";

export interface OverviewRow extends CloudStatusRow {
  user_id: string;
  email: string;
  username: string;
  communities: number;
  email_confirmed: boolean;
}

/**
 * Sends the 80% and 100% usage notices, once per meter per month per workspace. The cloud_notices row is written
 * before the email goes out, so a retry never double-sends; if usage jumped straight past 100%, only the 100%
 * notice is emailed. Returns how many emails were sent.
 */
export async function sendUsageNotices(db: SupabaseClient, rows: OverviewRow[], enabled: boolean, now = new Date()): Promise<number> {
  if (!enabled) return 0;
  const period = now.toISOString().slice(0, 7);
  let sent = 0;
  for (const row of rows) {
    const status = workspaceStatus(row, enabled);
    if (status.tier === "unlimited" || !row.email) continue;
    for (const m of status.meters) {
      if (m.limit === null || m.limit <= 0 || m.pct === null) continue;
      const reached = ([80, 100] as const).filter((t) => (m.pct ?? 0) >= t);
      if (!reached.length) continue;
      const { data: fresh } = await db
        .from("cloud_notices")
        .upsert(reached.map((pct) => ({ owner_id: row.user_id, period, meter: m.meter, pct })), { onConflict: "owner_id,period,meter,pct", ignoreDuplicates: true })
        .select("pct");
      const newest = Math.max(0, ...((fresh ?? []) as { pct: number }[]).map((r) => r.pct));
      if (newest !== 80 && newest !== 100) continue;
      const { subject, text } = noticeFor(status, m, newest);
      if ((await sendEmail(row.email, subject, text)).ok) sent++;
    }
  }
  return sent;
}
