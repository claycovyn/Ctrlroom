import "server-only";
import { CLOUD, cloudEnabled } from "@/lib/cloud";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Copies the switch (CTRLROOM_CLOUD) and the Free limits from openctrl.json into cloud_config, which is what the
 * database enforces. Runs when the server starts (src/instrumentation.ts) and whenever /admin loads.
 * Without a service-role key there's nothing to sync, and cloud_config stays off (never limited).
 */
export async function syncCloudConfig(): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };
  const { error } = await db
    .from("cloud_config")
    .update({ enabled: cloudEnabled(), free: CLOUD.free, updated_at: new Date().toISOString() })
    .eq("id", 1);
  return error ? { ok: false, error: error.message } : { ok: true };
}
