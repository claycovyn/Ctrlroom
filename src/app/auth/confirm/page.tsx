export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { NotConfigured } from "@/components/NotConfigured";
import { confirmCopy, isEmailLinkType } from "@/lib/authLinks";
import { linkNext } from "@/lib/authOrigins";
import { isConfigured } from "@/lib/env";
import { confirmLink } from "./actions";
import { ConfirmButton } from "./ConfirmButton";

export const metadata: Metadata = { title: "Confirm", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Opening the link only shows this page. Nothing is verified until the button is pressed (a POST), so link
// scanners that fetch every URL in an email can't spend the token.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isConfigured()) return <NotConfigured />;
  const sp = await searchParams;
  const type = isEmailLinkType(sp.type) ? sp.type : null;
  const tokenHash = sp.token_hash && type ? sp.token_hash : "";
  const code = sp.code ?? "";
  if (!tokenHash && !code) redirect("/login?error=link");
  const next = await linkNext(sp.next);
  const copy = confirmCopy(type);

  return (
    <AuthShell title={copy.title} lead={copy.body}>
      <form action={confirmLink}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type ?? ""} />
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="next" value={next} />
        <ConfirmButton label={copy.button} />
      </form>
    </AuthShell>
  );
}
