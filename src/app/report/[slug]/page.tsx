export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { currentUser } from "@/lib/supabase/server";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = { title: "Report", robots: { index: false } };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ m?: string }> }) {
  const { slug } = await params;
  const { m } = await searchParams;
  const { supabase, user } = await currentUser();
  const next = `/report/${slug}${m ? `?m=${encodeURIComponent(m)}` : ""}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  // Row-level security: members see their communities, everyone signed in sees public ones.
  const { data: community } = await supabase.from("communities").select("id, name, slug").eq("slug", slug).maybeSingle();
  if (!community) notFound();
  const messageId = m && /^[0-9a-f-]{36}$/.test(m) ? m : null;
  const { data: message } = messageId
    ? await supabase.from("messages").select("id, body").eq("id", messageId).eq("community_id", community.id).maybeSingle()
    : { data: null };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/app">
          <Logo />
        </Link>
        <div className="card mt-6 p-6">
          <h1 className="text-lg font-semibold">Report {message ? "a message" : community.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Reports go to the people who run this Ctrl Room, not to the community&apos;s owner or mods. Use it for spam,
            abuse and anything illegal. For everyday disagreements, talk to the community&apos;s mods.
          </p>
          {message && (
            <blockquote className="mt-4 max-h-32 overflow-hidden rounded-md border border-line bg-raised px-3 py-2 text-sm">
              {message.body || <em className="text-muted">Deleted message</em>}
            </blockquote>
          )}
          <div className="mt-5">
            <ReportForm communityId={community.id} messageId={message?.id ?? null} back={`/c/${community.slug}`} />
          </div>
        </div>
      </div>
    </main>
  );
}
