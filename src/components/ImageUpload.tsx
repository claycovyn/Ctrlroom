"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageCropper } from "@/components/ImageCropper";
import { pickProblem, type CropKind } from "@/lib/imageResize";
import { supabaseBrowser } from "@/lib/supabase/client";

type Supabase = ReturnType<typeof supabaseBrowser>;

export interface ImageSlotOptions {
  bucket: string;
  /** The URL saved now (null when empty). */
  initial: string | null;
  /** Why a file can't be uploaded, or null. Checked on the cropped, shrunk file (the bucket checks again). */
  problem: (file: File) => string | null;
  /** How the picked image is cropped and shrunk before upload. */
  crop: { kind: CropKind; maxBytes: number; title: string; round?: boolean };
  /** Where a new file goes in the bucket. */
  pathFor: (file: File) => string;
  /** The bucket path of a saved URL we own and may delete, or null. */
  objectPathOf: (url: string | null) => string | null;
  /** Save the URL (or null) on the row; returns the message to show when it fails, else null. */
  save: (supabase: Supabase, url: string | null) => Promise<string | null>;
  removeError: string;
  onChange?: (url: string | null) => void;
}

/**
 * Pick any image → crop it (ImageCropper) → shrink it to fit → upload → save URL → delete the old file;
 * remove → clear URL → delete the file.
 */
export function useImageSlot(o: ImageSlotOptions) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(o.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The picked file while the cropper is open. */
  const [picked, setPicked] = useState<File | null>(null);

  const done = (next: string | null) => {
    setUrl(next);
    o.onChange?.(next);
    router.refresh();
  };

  const clearInput = () => {
    if (input.current) input.current.value = "";
  };

  /** A file was picked: open the cropper, or say why it can't be used. */
  function pick(file: File) {
    clearInput();
    const problem = pickProblem(file);
    if (problem) return setError(problem);
    setError(null);
    setPicked(file);
  }

  function cancelCrop(err?: string) {
    setPicked(null);
    if (err) setError(err);
  }

  /** The cropped, shrunk file from the cropper. */
  async function upload(file: File) {
    setPicked(null);
    const problem = o.problem(file);
    if (problem) return setError(problem);
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
      clearInput();
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

  return { url, busy, error, input, picked, crop: o.crop, pick, cancelCrop, upload, remove };
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
          accept="image/*"
          className="sr-only"
          id={id}
          aria-label={label}
          disabled={slot.busy || !canAdd}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) slot.pick(file);
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
      {slot.picked && (
        <ImageCropper
          file={slot.picked}
          kind={slot.crop.kind}
          maxBytes={slot.crop.maxBytes}
          title={slot.crop.title}
          round={slot.crop.round}
          onCancel={slot.cancelCrop}
          onDone={slot.upload}
        />
      )}
    </div>
  );
}
