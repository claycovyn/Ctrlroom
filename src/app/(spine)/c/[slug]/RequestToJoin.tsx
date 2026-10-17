"use client";

import { useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Ask to join a private community that accepts requests (0008). An owner or admin approves or declines. */
export function RequestToJoin({ slug, pending: initiallyPending }: { slug: string; pending: boolean }) {
  const [pending, setPending] = useState(initiallyPending);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (pending) {
    return (
      <>
        <p role="status" className="rounded-md bg-signal/15 px-3 py-2 text-sm">
          Request sent. You&apos;ll get in once an admin approves.
        </p>
        <button
          className="btn-ghost mt-3 w-full text-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { error: err } = await supabaseBrowser().rpc("cancel_join_request", { p_slug: slug });
            setBusy(false);
            if (err) return setError("Couldn't cancel. Try again.");
            setPending(false);
          }}
        >
          Cancel request
        </button>
        {error && <p className="mt-2 text-sm text-alert">{error}</p>}
      </>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error: err } = await supabaseBrowser().rpc("request_to_join", { p_slug: slug, p_message: message.trim() });
        setBusy(false);
        if (err) return setError(cloudErrorText(err.message) ?? "Couldn't send the request. Try again.");
        setPending(true);
      }}
    >
      <p className="mb-3 text-sm text-muted">This community is private. Ask to join and an admin will look at your request.</p>
      <label className="label" htmlFor="request-message">
        Message (optional)
      </label>
      <textarea
        id="request-message"
        className="input min-h-20 resize-y"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={500}
        placeholder="Who you are, or who sent you"
      />
      <button className="btn-primary mt-3 w-full" disabled={busy}>
        {busy ? "Sending…" : "Request to join"}
      </button>
      {error && <p className="mt-2 text-sm text-alert">{error}</p>}
    </form>
  );
}
