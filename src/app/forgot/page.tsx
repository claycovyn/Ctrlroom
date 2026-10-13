export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { NotConfigured } from "@/components/NotConfigured";
import { LINK_ERRORS } from "@/lib/authLinks";
import { isConfigured } from "@/lib/env";
import { ForgotForm } from "./ForgotForm";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { error } = await searchParams;
  const problem = error ? LINK_ERRORS[error] : undefined;

  return (
    <AuthShell title="Reset your password" lead="Enter your email and we'll send you a link to choose a new one.">
      {problem && (
        <p role="alert" className="mb-4 text-sm text-alert">
          {problem}
        </p>
      )}
      <ForgotForm />
    </AuthShell>
  );
}
