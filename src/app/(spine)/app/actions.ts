"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { slugify } from "@/lib/format";
import { friendlyJoinError, inviteCodeFrom } from "@/lib/invites";
import { supabaseServer } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Give it a name (2+ characters).").max(64),
  slug: z.string().trim().optional(),
  description: z.string().trim().max(280).optional(),
  icon: z.string().trim().max(8).optional(),
});

export async function createCommunity(_: FormState, form: FormData): Promise<FormState> {
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, description, icon } = parsed.data;
  const slug = slugify(parsed.data.slug || name);
  if (slug.length < 3) return { error: "The link name needs at least 3 letters or numbers." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("create_community", {
    p_name: name,
    p_slug: slug,
    p_description: description ?? "",
    p_icon: icon ?? "",
  });
  if (error) {
    return { error: error.code === "23505" ? `ctrlroom/${slug} is taken. Try another link name.` : error.message };
  }
  redirect(`/c/${slug}`);
}

export async function joinCommunity(_: FormState, form: FormData): Promise<FormState> {
  const code = inviteCodeFrom(String(form.get("code") ?? ""));
  if (!code) return { error: "Paste an invite link or code." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("join_with_invite", { p_code: code });
  if (error) return { error: friendlyJoinError(error.message) };
  redirect(`/c/${data}`);
}
