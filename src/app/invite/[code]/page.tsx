import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { friendlyJoinError } from "@/lib/invites";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invite", robots: { index: false } };

// ?room=<slug> opens that room after joining (e.g. a waitlist room); anything that isn't a room slug is ignored.
const ROOM_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ room?: string }>;
}) {
  const { code } = await params;
  const { room } = await searchParams;
  const roomSlug = room && ROOM_SLUG.test(room) ? room : null;
  const { supabase, user } = await currentUser();
  if (!user) redirect(`/login?mode=signup&next=${encodeURIComponent(`/invite/${code}${roomSlug ? `?room=${roomSlug}` : ""}`)}`);

  const { data, error } = await supabase.rpc("join_with_invite", { p_code: code });
  if (!error && data) redirect(roomSlug ? `/c/${data}/${roomSlug}` : `/c/${data}`);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Logo />
        <div className="card mt-6 p-6">
          <h1 className="mb-2 text-lg font-semibold">This invite didn’t work</h1>
          <p className="mb-4 text-sm text-muted">{friendlyJoinError(error?.message ?? "Unknown error")}</p>
          <Link href="/app" className="btn-outline">
            Back to your communities
          </Link>
        </div>
      </div>
    </main>
  );
}
