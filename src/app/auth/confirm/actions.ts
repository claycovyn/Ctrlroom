"use server";

import { redirect } from "next/navigation";
import { destinationFor, isEmailLinkType } from "@/lib/authLinks";
import { linkNext } from "@/lib/authOrigins";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Finishes an email link. Runs only when the person presses the button on /auth/confirm, so a mail scanner that
 * opens the link (a GET) can't use it up. token_hash links are verified here, in whatever browser opened them.
 */
export async function confirmLink(form: FormData): Promise<void> {
  const tokenHash = form.get("token_hash");
  const code = form.get("code");
  const rawType = form.get("type");
  const type = isEmailLinkType(rawType) ? rawType : null;
  const next = await linkNext(form.get("next"));
  const supabase = await supabaseServer();

  if (typeof tokenHash === "string" && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) redirect("/login?error=link");
    redirect(destinationFor(type, next));
  }
  if (typeof code === "string" && code) {
    // ?code= links (Supabase's default templates, PKCE) only work in the browser that asked for them.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect("/login?error=link");
    redirect(next);
  }
  redirect("/login?error=link");
}
