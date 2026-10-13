"use client";

import Link from "next/link";
import { useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { REPORT_REASONS as REASONS } from "@/lib/reportReasons";
import { supabaseBrowser } from "@/lib/supabase/client";

export function ReportForm({ communityId, messageId, back }: { communityId: string; messageId: string | null; back: string }) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div role="status">
        <p className="font-medium">Thanks. Your report was sent.</p>
        <p className="mt-1 text-sm text-muted">Someone will look at it. You won&apos;t be named to the person you reported.</p>
        <Link href={back} className="btn-outline mt-4 inline-flex">
          Back
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error: err } = await supabaseBrowser().rpc("report", {
          p_community: communityId,
          p_message: messageId,
          p_reason: reason,
          p_details: details.trim(),
        });
        setBusy(false);
        if (err) return setError(cloudErrorText(err.message) ?? "Couldn't send the report. Try again.");
        setDone(true);
      }}
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">What&apos;s wrong?</legend>
        {REASONS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <textarea
        className="input min-h-[5rem]"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={1000}
        placeholder="Anything that helps (optional)"
        aria-label="Details"
      />
      {error && <p className="text-sm text-alert" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </button>
        <Link href={back} className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
