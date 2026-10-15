"use client";

import { useId, useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { BIO_MAX } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Turning the public profile back on (set_public_profile, 0020). Profiles are public by default; this shows only for
 * people who turned theirs off, who are then seen only by people they share a community or a conversation with.
 */
export function PublicProfileSetup({ me, onDone }: { me: { id: string; bio: string; is_private: boolean }; onDone: () => void }) {
  const id = useId();
  const [bio, setBio] = useState(me.bio);
  const [priv, setPriv] = useState(me.is_private);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const steps = [
      () => sb.from("profiles").update({ bio: bio.trim() }).eq("id", me.id),
      () => sb.rpc("set_private_account", { p_private: priv }),
      () => sb.rpc("set_public_profile", { p_on: true }),
    ];
    for (const step of steps) {
      const { error: err } = await step();
      if (err) {
        setBusy(false);
        return setError(cloudErrorText(err.message) ?? "Couldn't save that. Try again.");
      }
    }
    setBusy(false);
    onDone();
  };

  return (
    <form onSubmit={submit} className="card m-4 space-y-3 p-5">
      <h2 className="text-base font-semibold">Your public profile is off</h2>
      <p className="text-sm text-muted">
        Turn it on to post and let people follow you. Anyone signed in can then see your name, photo and bio. While it&apos;s off, only people you share a community or a conversation with can see you.
      </p>
      <div>
        <label htmlFor={`${id}-bio`} className="mb-1 block text-sm font-medium">
          Bio <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={`${id}-bio`} className="input min-h-[3.5rem]" value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
        <span>
          <span className="font-medium">Private account</span>
          <span className="block text-muted">Only followers you approve see your posts.</span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Turning on…" : "Turn on"}
      </button>
    </form>
  );
}
