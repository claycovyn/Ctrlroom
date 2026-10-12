import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { cleanCosts, CLOUD, planOf } from "@/lib/cloud";
import { syncCloudConfig } from "@/lib/cloudSync";
import { sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Operator actions from the plain HTML forms on /admin. Browser session only; same-origin posts only. */
export async function POST(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const db = supabaseAdmin();
  if (!db) return back(req, "Set SUPABASE_SERVICE_ROLE_KEY first.", true);

  const f = await req.formData();
  const s = (k: string) => String(f.get(k) ?? "").trim();
  const uuid = (k: string) => (/^[0-9a-f-]{36}$/.test(s(k)) ? s(k) : null);
  const now = new Date().toISOString();
  let msg = "Saved.";

  switch (s("action")) {
    case "plan": {
      const userId = uuid("userId");
      if (!userId || !["free", "cloud", "grandfathered"].includes(s("plan"))) return back(req, "Unknown workspace or plan.", true);
      const plan = planOf(s("plan"));
      const { error } = await db.from("cloud_plans").upsert({ user_id: userId, plan, updated_at: now }, { onConflict: "user_id" });
      if (error) return back(req, error.message, true);
      msg = `Plan set to ${plan}.`;
      break;
    }
    case "packs": {
      const userId = uuid("userId");
      if (!userId) return back(req, "Unknown workspace.", true);
      const packs = Object.fromEntries(
        CLOUD.packs.map((p) => [p.id, Math.max(0, Math.min(1000, Math.floor(Number(s(`pack_${p.id}`)) || 0)))]).filter(([, n]) => (n as number) > 0),
      );
      const { data: existing } = await db.from("cloud_plans").select("plan").eq("user_id", userId).maybeSingle();
      const { error } = await db
        .from("cloud_plans")
        .upsert({ user_id: userId, plan: existing?.plan ?? "grandfathered", packs, updated_at: now }, { onConflict: "user_id" });
      if (error) return back(req, error.message, true);
      msg = "Packs saved.";
      break;
    }
    case "costs": {
      const { error } = await db.from("app_settings").upsert({ key: "unit_costs", value: cleanCosts(Object.fromEntries(f.entries())), updated_at: now });
      if (error) return back(req, error.message, true);
      msg = "Unit costs saved.";
      break;
    }
    case "takedown": {
      const slug = s("slug").toLowerCase();
      const reason = s("reason").slice(0, 500) || "Removed by the operator.";
      const { data, error } = await db.from("communities").update({ taken_down_at: now, taken_down_reason: reason }).eq("slug", slug).select("id");
      if (error) return back(req, error.message, true);
      if (!data?.length) return back(req, `No community called "${slug}".`, true);
      if (uuid("reportId")) await db.from("reports").update({ resolved_at: now, resolution: "taken down" }).eq("id", uuid("reportId"));
      msg = `/c/${slug} taken down. Members keep read access and export; new messages, calls and joins are off.`;
      break;
    }
    case "restore": {
      const { error } = await db.from("communities").update({ taken_down_at: null, taken_down_reason: null }).eq("slug", s("slug").toLowerCase());
      if (error) return back(req, error.message, true);
      msg = `/c/${s("slug")} restored.`;
      break;
    }
    case "dismiss": {
      const { error } = await db.from("reports").update({ resolved_at: now, resolution: "dismissed" }).eq("id", uuid("reportId") ?? "");
      if (error) return back(req, error.message, true);
      msg = "Report dismissed.";
      break;
    }
    case "sync": {
      const r = await syncCloudConfig();
      if (!r.ok) return back(req, r.error ?? "Sync failed.", true);
      msg = "Cloud settings synced from openctrl.json and CTRLROOM_CLOUD.";
      break;
    }
    case "test-email": {
      const r = await sendEmail(admin.email!, "Ctrl Room test email", "Email from Ctrl Room works. Usage notices will come from this address.");
      if (!r.ok) return back(req, r.error ?? "Couldn't send.", true);
      msg = `Test email sent to ${admin.email}.`;
      break;
    }
    default:
      return back(req, "Unknown action.", true);
  }
  return back(req, msg);
}

function back(req: Request, msg: string, bad = false) {
  const url = new URL("/admin", req.url);
  url.searchParams.set(bad ? "error" : "done", msg);
  return NextResponse.redirect(url, 303);
}
