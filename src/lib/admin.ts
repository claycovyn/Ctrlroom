// Operators: signed-in people whose confirmed email is in CTRLROOM_ADMIN_EMAILS (comma-separated).
import "server-only";
import type { User } from "@supabase/supabase-js";
import { currentUser } from "@/lib/supabase/server";

export function adminEmails(): string[] {
  return (process.env.CTRLROOM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(user: Pick<User, "email" | "email_confirmed_at"> | null): boolean {
  return !!user?.email && !!user.email_confirmed_at && adminEmails().includes(user.email.toLowerCase());
}

export async function currentAdmin(): Promise<User | null> {
  const { user } = await currentUser();
  return isAdmin(user) ? user : null;
}
