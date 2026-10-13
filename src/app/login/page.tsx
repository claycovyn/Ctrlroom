export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { NotConfigured } from "@/components/NotConfigured";
import { LINK_ERRORS } from "@/lib/authLinks";
import { isConfigured } from "@/lib/env";
import { safeNext } from "@/lib/safeNext";
import { currentUser } from "@/lib/supabase/server";
import { AuthForm } from "./AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const mode = sp.mode === "signup" ? "signup" : "signin";
  const problem = sp.error ? LINK_ERRORS[sp.error] : undefined;
  if (!isConfigured()) return <NotConfigured />;
  const { user } = await currentUser();
  if (user) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block">
          <Logo />
        </Link>
        <div className="card p-6">
          <h1 className="mb-1 text-xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="mb-6 text-sm text-muted">
            {next.startsWith("/invite/") ? "Sign in to accept your invite." : "One account for every community you join."}
          </p>
          {problem && (
            <p role="alert" className="mb-4 text-sm text-alert">
              {problem}
            </p>
          )}
          <AuthForm mode={mode} next={next} />
        </div>
      </div>
    </main>
  );
}
