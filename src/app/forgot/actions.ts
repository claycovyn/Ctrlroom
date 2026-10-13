"use server";

import { z } from "zod";
import { siteUrl } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export interface ForgotState {
  error?: string;
  notice?: string;
}

const schema = z.object({ email: z.string().trim().email("Enter a valid email.") });

export async function sendReset(_: ForgotState, form: FormData): Promise<ForgotState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  // Rate limits are Supabase Auth's: one email per address per `max_frequency` and the project's emails-per-hour
  // cap. Its errors (including "too many requests") aren't shown, because Supabase only reaches them for real
  // accounts, so showing them would tell a stranger the account exists. Same answer every time.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/auth/reset`,
  });
  if (error) console.warn(`password reset email not sent: ${error.code ?? error.status ?? "error"}`);
  return { notice: "If an account exists for that email, we sent a link to reset the password." };
}
