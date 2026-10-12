"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { AVATAR_ACCEPT, AVATAR_BUCKET, AVATAR_HINT, avatarFileProblem, avatarObjectPath, avatarPath } from "@/lib/avatar";
import { cloudErrorText } from "@/lib/cloudErrors";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

/** Upload, replace or remove your own profile photo. */
export function ProfilePhoto({ profile, onChange }: { profile: Profile; onChange?: (url: string | null) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(profile.avatar_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (next: string | null) => {
    setUrl(next);
    onChange?.(next);
    router.refresh();
  };

  async function upload(file: File) {
    const problem = avatarFileProblem(file);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    const storage = supabase.storage.from(AVATAR_BUCKET);
    try {
      const path = avatarPath(profile.id, file.type);
      const up = await storage.upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (up.error) return setError("Couldn't upload that image. Try again.");
      const next = storage.getPublicUrl(path).data.publicUrl;
      const { error: err } = await supabase.from("profiles").update({ avatar_url: next }).eq("id", profile.id);
      if (err) {
        await storage.remove([path]);
        return setError(cloudErrorText(err.message) ?? "Couldn't save your photo.");
      }
      const old = avatarObjectPath(url, profile.id);
      if (old) await storage.remove([old]);
      done(next);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    try {
      const { error: err } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
      if (err) return setError("Couldn't remove your photo.");
      const old = avatarObjectPath(url, profile.id);
      if (old) await supabase.storage.from(AVATAR_BUCKET).remove([old]);
      done(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar profile={{ ...profile, avatar_url: url }} size={64} />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            id="profile-photo"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <button type="button" className="btn-outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Saving…" : url ? "Replace" : "Upload"}
          </button>
          {url && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{AVATAR_HINT}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
