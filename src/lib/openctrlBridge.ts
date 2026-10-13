// The Supabase side of "Continue with OpenCtrl". Supabase Auth can't use OpenCtrl as a sign-in provider directly, so
// after OpenCtrl vouches for someone (openctrlLogin.ts) the server signs them in itself: it asks Supabase for a
// one-time magic-link token (generateLink sends no email) and redeems it straight away with the browser's session
// client, which sets the normal Supabase session cookies.
//
// This is the one place outside operator and bot work that uses the service-role client: it touches only the link
// table, the email lookup and Supabase Auth's admin API, never a person's data.
import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { supabaseServer } from "./supabase/server";

function admin() {
  const a = supabaseAdmin();
  if (!a) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Continue with OpenCtrl");
  return a;
}

export async function linkedUserId(sub: string): Promise<string | null> {
  const { data, error } = await admin().from("openctrl_links").select("user_id").eq("sub", sub).maybeSingle();
  if (error) throw error;
  return (data?.user_id as string | undefined) ?? null;
}

export async function linkedSubOf(userId: string): Promise<string | null> {
  const { data, error } = await admin().from("openctrl_links").select("sub").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data?.sub as string | undefined) ?? null;
}

export async function accountByEmail(email: string): Promise<{ id: string; emailConfirmedAt: string | null } | null> {
  const { data, error } = await admin().rpc("openctrl_account_by_email", { p_email: email });
  if (error) throw error;
  const row = (data as { id: string; email_confirmed_at: string | null }[] | null)?.[0];
  return row ? { id: row.id, emailConfirmedAt: row.email_confirmed_at } : null;
}

/** False when that OpenCtrl account or that user is already linked (unique on both). */
export async function link(userId: string, sub: string): Promise<boolean> {
  const { error } = await admin().from("openctrl_links").insert({ sub, user_id: userId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

/** A confirmed account for someone OpenCtrl vouched for. The display name comes from OpenCtrl; the username is made by the usual trigger. */
export async function createAccount(email: string, name: string | undefined): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: name?.trim() ? { display_name: name.trim().slice(0, 64) } : {},
  });
  if (error || !data.user) throw error ?? new Error("Couldn't create the account");
  return data.user.id;
}

export async function emailOf(userId: string): Promise<string | null> {
  const { data, error } = await admin().auth.admin.getUserById(userId);
  if (error) throw error;
  return data.user?.email ?? null;
}

/** Signs this browser in as the user: a one-time token from Supabase, redeemed at once into session cookies. */
export async function signInAs(email: string): Promise<void> {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw error ?? new Error("Couldn't start the session");
  const supabase = await supabaseServer();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (verifyError) throw verifyError;
}
