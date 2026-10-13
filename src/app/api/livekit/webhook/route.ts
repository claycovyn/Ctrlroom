import { NextResponse, type NextRequest } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { callMinutes, roomIdFromLiveKit } from "@/lib/cloud";
import { dispatchPush } from "@/lib/pushServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * LiveKit webhook (Project settings → Webhooks → https://<site>/api/livekit/webhook). Signed with the LiveKit API key
 * and secret.
 *   - participant_left: their minutes are added to the community owner's usage. Each event counts once even if
 *     LiveKit retries it (record_call is idempotent per event id).
 *   - participant_joined: the first join of a call session sends "X started a call" pushes (push_call_started in
 *     0014_push.sql, once per LiveKit room sid).
 */
export async function POST(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const db = supabaseAdmin();
  if (!key || !secret || !db) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const body = await request.text();
  let event;
  try {
    event = await new WebhookReceiver(key, secret).receive(body, request.headers.get("authorization") ?? undefined);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  if (event.event === "participant_joined" && event.participant) {
    const roomId = roomIdFromLiveKit(event.room?.name);
    const session = event.room?.sid;
    if (!roomId || !session) return NextResponse.json({ ok: true, ignored: "not a Ctrl Room room" });
    const { data, error } = await db.rpc("push_call_started", { p_session: session, p_room: roomId, p_user: event.participant.identity });
    // A missed call notification isn't worth a retry storm: answer 200 either way.
    if (error) console.warn(`[ctrlroom] push_call_started failed: ${error.message}`);
    if (!error && Number(data) > 0) await dispatchPush(db).catch((e) => console.warn(`[ctrlroom] push dispatch failed: ${(e as Error).message}`));
    return NextResponse.json({ ok: true, notified: Number(data) || 0 });
  }

  if (event.event !== "participant_left" || !event.participant) return NextResponse.json({ ok: true, ignored: event.event });
  const roomId = roomIdFromLiveKit(event.room?.name);
  if (!roomId) return NextResponse.json({ ok: true, ignored: "not a Ctrl Room room" });

  const minutes = callMinutes(Number(event.participant.joinedAt), Number(event.createdAt) || Math.floor(Date.now() / 1000));
  const { data, error } = await db.rpc("record_call", { p_event: event.id, p_room: roomId, p_minutes: minutes });
  // A 500 makes LiveKit retry; the event id keeps a retry from counting twice.
  if (error) return NextResponse.json({ error: "Couldn't record usage" }, { status: 500 });
  return NextResponse.json({ ok: true, recorded: data === true, minutes });
}
