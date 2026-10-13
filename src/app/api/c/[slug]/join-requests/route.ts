import { NextResponse } from "next/server";
import { cloudErrorText } from "@/lib/cloudErrors";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import { approvedEmail } from "@/lib/joinRequests";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Approve or decline a join request: { id, approve }. The decision runs as the signed-in person through
 * decide_join_request (0008), which checks they're an owner or admin. Only after an approval does the server
 * look up the requester's email address (service role, the same way usage notices do) to send "You're in".
 * The address never reaches the browser. No email setup: the approval still works, nothing is sent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; approve?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  if (!id || typeof body?.approve !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { data: status, error } = await supabase.rpc("decide_join_request", { p_id: id, p_approve: body.approve });
  if (error) {
    return NextResponse.json({ error: cloudErrorText(error.message) ?? "Couldn't answer the request." }, { status: 400 });
  }

  let emailed = false;
  if (status === "approved") {
    // Readable by the deciding owner/admin (join_requests_select).
    const { data: row } = await supabase.from("join_requests").select("user_id, communities(name, slug)").eq("id", id).maybeSingle();
    const community = (row?.communities ?? null) as unknown as { name: string; slug: string } | null;
    const db = supabaseAdmin();
    if (row && community && community.slug === slug && db) {
      const { data } = await db.auth.admin.getUserById(row.user_id as string);
      const to = data?.user?.email;
      if (to) {
        const { subject, text } = approvedEmail(community.name, `${siteUrl()}/c/${community.slug}`);
        emailed = (await sendEmail(to, subject, text)).ok;
      }
    }
  }
  return NextResponse.json({ status, emailed });
}
