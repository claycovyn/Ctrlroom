import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/env";
import { icsFor } from "@/lib/ics";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const { supabase, user } = await currentUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  // RLS: only members of the event's community can read it.
  const { data: event } = await supabase.from("events").select("id, title, description, starts_at, ends_at, community_id").eq("id", id).maybeSingle();
  if (!event) return new NextResponse("Not found", { status: 404 });
  const { data: community } = await supabase.from("communities").select("slug").eq("id", event.community_id).single();
  const body = icsFor({ ...event, url: `${siteUrl()}/c/${community?.slug ?? ""}/calendar` });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ctrlroom-event.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
