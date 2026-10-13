"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PASSWORD_MIN } from "@/lib/authLinks";
import { siteUrl } from "@/lib/env";
import { link } from "@/lib/openctrlBridge";
import { LINK_COOKIE, openCookie, openctrlConfig } from "@/lib/openctrlLogin";
import { safeNext } from "@/lib/safeNext";
import { supabaseServer } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  notice?: string;
}

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

const signUpSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,32}$/, "Usernames are 2–32 letters, numbers or underscores."),
  display_name: z.string().trim().min(1, "Add a display name.").max(64),
});

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "That email and password don't match." };
  await finishOpenctrlLink(data.user?.id, data.user?.email);
  redirect(safeNext(form.get("next")));
}

/**
 * Came from "Continue with OpenCtrl" with an email that already had an account here: the password proves it's theirs,
 * so connect the two now. Never blocks signing in.
 */
async function finishOpenctrlLink(userId: string | undefined, email: string | undefined) {
  const config = openctrlConfig();
  const jar = await cookies();
  const raw = jar.get(LINK_COOKIE)?.value;
  if (!config || !raw || !userId || !email) return;
  jar.delete(LINK_COOKIE);
  const pending = openCookie<{ sub: string; email: string }>(config.clientSecret, "oc-link", raw);
  if (!pending || pending.email !== email.toLowerCase()) return;
  try {
    await link(userId, pending.sub);
  } catch (e) {
    console.error("[openctrl] link after password sign-in:", e instanceof Error ? e.message : e);
  }
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, username, display_name } = parsed.data;
  const next = safeNext(form.get("next"));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, display_name },
      // The confirmation email links to /auth/confirm and passes this along as its next (templates/confirmation.html).
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };
  if (!data.session) return { notice: `Check ${email} for a link to confirm your account.` };
  redirect(next);
}
