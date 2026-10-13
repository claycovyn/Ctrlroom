export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { NotConfigured } from "@/components/NotConfigured";
import { isConfigured } from "@/lib/env";
import { safeNext } from "@/lib/safeNext";
import { currentUser } from "@/lib/supabase/server";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

// Reached from a reset or invite email (via /auth/confirm, which signs the person in). No session, or an expired
// one, means the link wasn't used here: send them back for a new one.
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isConfigured()) return <NotConfigured />;
  const sp = await searchParams;
  const { user } = await currentUser();
  if (!user) redirect("/forgot?error=expired");

  return (
    <AuthShell
      title="Set a new password"
      lead={
        <>
          For <span className="font-medium text-fg">{user.email}</span>.
        </>
      }
    >
      <ResetForm next={safeNext(sp.next)} />
    </AuthShell>
  );
}
