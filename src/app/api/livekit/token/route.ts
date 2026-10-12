import { NextResponse, type NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const body = z.object({ roomId: z.string().uuid() });

/**
 * Issues a short-lived LiveKit token for a Ctrl Room room. The room lookup goes through
 * row-level security, so only members of the room's community get a token.
 */
export async function POST(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !url) {
    return NextResponse.json({ error: "Voice and video aren't set up yet (LiveKit keys missing)." }, { status: 503 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const [{ data: room }, { data: profile }] = await Promise.all([
    supabase.from("rooms").select("id, community_id").eq("id", parsed.data.roomId).maybeSingle(),
    supabase.from("profiles").select("display_name, username").eq("id", user.id).single(),
  ]);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Takedowns and the Free Cloud call-minute limit (never on a self-hosted install). Calls already running go on.
  // If the check itself fails (e.g. the 0002 migration isn't applied yet), the call goes ahead: a limit check
  // never takes calls down.
  const { data: blocked, error: guardError } = await supabase.rpc("call_allowed", { p_room: room.id });
  if (guardError) console.warn(`[ctrlroom] call_allowed failed: ${guardError.message}`);
  if (!guardError && blocked) return NextResponse.json({ error: blocked }, { status: blocked === "Room not found" ? 404 : 403 });

  const token = new AccessToken(key, secret, {
    identity: user.id,
    name: profile?.display_name ?? "Member",
    metadata: JSON.stringify({ username: profile?.username }),
    ttl: "2h",
  });
  token.addGrant({
    room: `ctrlroom-${room.id}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({ token: await token.toJwt(), url }, { headers: { "Cache-Control": "no-store" } });
}
