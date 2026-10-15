"use client";

import { useId, useState } from "react";
import { ModalSheet, SheetActions } from "@/components/Dialogs";
import { cloudErrorText } from "@/lib/cloudErrors";
import { REPORT_REASONS } from "@/lib/reportReasons";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Report a post to the people who run this Ctrl Room (report_post, 0020). Same reasons as /report. */
export function ReportPostDialog({ postId, author, preview, onClose }: { postId: string; author: string; preview: string; onClose: () => void }) {
  const uid = useId();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc("report_post", { p_post: postId, p_reason: reason, p_details: details.trim() });
    setBusy(false);
    if (err) return setError(cloudErrorText(err.message) ?? "Couldn't send the report. Try again.");
    setDone(true);
  };

  return (
    <ModalSheet onCancel={onClose} labelledBy={`${uid}-title`}>
      {done ? (
        <div className="cr-sheet-body" role="status">
          <div className="space-y-2 px-5 pb-4 pt-5">
            <h2 id={`${uid}-title`} className="text-base font-semibold">
              Thanks. Your report was sent.
            </h2>
            <p className="text-sm text-muted">Someone will look at it. {author} won&apos;t be told who reported them. You can also block them from their profile.</p>
          </div>
          <SheetActions>
            <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
              Done
            </button>
          </SheetActions>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="cr-sheet-body">
          <div className="shrink-0 px-5 pt-5">
            <h2 id={`${uid}-title`} className="text-base font-semibold leading-snug [overflow-wrap:anywhere]">
              Report {author}&apos;s post
            </h2>
            <p className="mt-1 text-sm text-muted">Reports go to the people who run this Ctrl Room. They&apos;ll see this post.</p>
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-3">
            <blockquote className="max-h-24 overflow-hidden rounded-md border border-line bg-raised px-3 py-2 text-sm [overflow-wrap:anywhere]">{preview}</blockquote>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">What&apos;s wrong?</legend>
              {REPORT_REASONS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${uid}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <textarea className="input min-h-[4.5rem]" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Anything that helps (optional)" aria-label="Details" />
            {error && (
              <p className="text-sm text-alert" role="alert">
                {error}
              </p>
            )}
          </div>
          <SheetActions>
            <button type="button" className="btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Send report"}
            </button>
          </SheetActions>
        </form>
      )}
    </ModalSheet>
  );
}
