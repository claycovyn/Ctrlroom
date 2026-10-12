import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLOUD_PRICE_LABEL, packOffer, workspaceStatus, type CloudStatusRow, type WorkspaceStatus } from "@/lib/cloud";

export interface MyCloud {
  enabled: boolean;
  owns: number;
  emailConfirmed: boolean;
  status: WorkspaceStatus;
  /** Shown with the usage: where to join OPENCTRL Cloud (OPENCTRL_CLOUD_URL), or null while billing isn't live. */
  upgrade: { price: string; url: string | null };
  /** Pack labels per meter, for "add a pack" offers to subscribers. */
  packs: Record<string, string[]>;
}

/** The signed-in person's plan and this month's usage across the communities they own. null if unavailable. */
export async function loadMyCloud(supabase: SupabaseClient): Promise<MyCloud | null> {
  const { data, error } = await supabase.rpc("my_cloud_status");
  if (error || !data) return null;
  const row = data as CloudStatusRow & { enabled: boolean; owns: number; email_confirmed: boolean };
  const status = workspaceStatus(row, Boolean(row.enabled));
  return {
    enabled: Boolean(row.enabled),
    owns: Number(row.owns) || 0,
    emailConfirmed: Boolean(row.email_confirmed),
    status,
    upgrade: { price: CLOUD_PRICE_LABEL, url: process.env.OPENCTRL_CLOUD_URL || null },
    packs: Object.fromEntries(status.meters.map((m) => [m.meter, packOffer(m.meter)])),
  };
}
