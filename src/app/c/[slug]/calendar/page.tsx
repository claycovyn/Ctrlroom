import type { Metadata } from "next";
import { CalendarView } from "@/components/hub/CalendarView";
import { loadCommunity } from "@/lib/community";
import type { CalendarEvent, RsvpStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, community, role } = await loadCommunity(slug);
  if (!role) return null;
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("community_id", community.id)
    .gte("ends_at", since)
    .order("starts_at")
    .limit(300);
  const ids = ((events ?? []) as CalendarEvent[]).map((e) => e.id);
  const { data: rsvps } = ids.length
    ? await supabase.from("event_rsvps").select("event_id, user_id, status").in("event_id", ids).limit(5000)
    : { data: [] };
  return (
    <CalendarView
      initialEvents={(events ?? []) as CalendarEvent[]}
      initialRsvps={(rsvps ?? []) as { event_id: string; user_id: string; status: RsvpStatus }[]}
    />
  );
}
