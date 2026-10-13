import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/** The centered card the sign-in, reset and confirm pages share. */
export function AuthShell({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block">
          <Logo />
        </Link>
        <div className="card p-6">
          <h1 className="mb-1 text-xl font-semibold">{title}</h1>
          {lead && <p className="mb-6 text-sm text-muted">{lead}</p>}
          {children}
        </div>
      </div>
    </main>
  );
}
