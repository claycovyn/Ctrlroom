"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PASSWORD_MIN } from "@/lib/authLinks";
import { safeNext } from "@/lib/safeNext";
import { supabaseServer } from "@/lib/supabase/server";

export interface ResetState {
  error?: string;
}

const schema = z
  .object({
    password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

export async function setPassword(_: ResetState, form: FormData): Promise<ResetState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/forgot?error=expired");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "That's your current password. Pick a new one." };
    if (error.code === "weak_password") return { error: "Pick a stronger password." };
    if (error.status === 401 || error.code === "session_expired" || error.code === "session_not_found") {
      redirect("/forgot?error=expired");
    }
    return { error: "Couldn't save that password. Try again." };
  }
  const next = safeNext(form.get("next"));
  redirect(next === "/app" ? "/app?done=password" : next);
}
