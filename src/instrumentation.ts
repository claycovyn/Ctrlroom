export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { syncCloudConfig } = await import("@/lib/cloudSync");
  const r = await syncCloudConfig().catch((e: unknown) => ({ ok: false, error: String(e) }));
  if (!r.ok && process.env.SUPABASE_SERVICE_ROLE_KEY) console.warn(`[ctrlroom] cloud config sync failed: ${r.error}`);
}
