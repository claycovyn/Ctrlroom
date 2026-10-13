"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IMAGE_ACCEPT } from "@/lib/media";
import { supabaseBrowser } from "@/lib/supabase/client";

type Supabase = ReturnType<typeof supabaseBrowser>;

export interface ImageSlotOptions {
  bucket: string;
  /** The URL saved now (null when empty). */
  initial: string | null;
  /** Why a file can't be used, or null. */
  problem: (file: File) => string | null;
  /** Where a new file goes in the bucket. */
  pathFor: (file: File) => string;
  /** The bucket path of a saved URL we own and may delete, or null. */
  objectPathOf: (url: string | null) => string | null;
  /** Save the URL (or null) on the row; returns the message to show when it fails, else null. */
  save: (supabase: Supabase, url: string | null) => Promise<string | null>;
  removeError: string;
  onChange?: (url: string | null) => void;
}

/** Upload → save URL → delete the old file; remove → clear URL → delete the file. */
export function useImageSlot(o: ImageSlotOptions) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(o.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (next: string | null) => {
    setUrl(next);
    o.onChange?.(next);
    router.refresh();
  };

  async function upload(file: File) {
    const problem = o.problem(file);
    if (problem) {
      if (input.current) input.current.value = "";
      return setError(problem);
    }
    setError(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    const storage = supabase.storage.from(o.bucket);
    try {
      const path = o.pathFor(file);
      const up = await storage.upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (up.error) return setError("Couldn't upload that image. Try again.");
      const next = storage.getPublicUrl(path).data.publicUrl;
      const err = await o.save(supabase, next);
      if (err) {
        await storage.remove([path]);
        return setError(err);
      }
      const old = o.objectPathOf(url);
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
      const err = await o.save(supabase, null);
      if (err) return setError(o.removeError);
      const old = o.objectPathOf(url);
      if (old) await supabase.storage.from(o.bucket).remove([old]);
      done(null);
    } finally {
      setBusy(false);
    }
  }

  return { url, busy, error, input, upload, remove };
}

export type ImageSlot = ReturnType<typeof useImageSlot>;

/** Upload / Replace / Remove buttons, the hint and any error, for one image slot. */
export function ImageButtons({
  slot,
  id,
  hint,
  label,
  canAdd = true,
}: {
  slot: ImageSlot;
  id: string;
  hint: string;
  label: string;
  /** False hides Upload/Replace (e.g. a taken-down community); Remove still works. */
  canAdd?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2">
        <input
          ref={slot.input}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          id={id}
          aria-label={label}
          disabled={slot.busy || !canAdd}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) slot.upload(file);
          }}
        />
        {canAdd && (
          <button type="button" className="btn-outline" disabled={slot.busy} onClick={() => slot.input.current?.click()}>
            {slot.busy ? "Saving…" : slot.url ? "Replace" : "Upload"}
          </button>
        )}
        {slot.url && (
          <button type="button" className="btn-ghost" disabled={slot.busy} onClick={slot.remove}>
            Remove
          </button>
        )}
      </div>
      {canAdd && <p className="mt-2 text-xs text-muted">{hint}</p>}
      {slot.error && (
        <p role="alert" className="mt-1 text-xs text-alert">
          {slot.error}
        </p>
      )}
    </div>
  );
}
