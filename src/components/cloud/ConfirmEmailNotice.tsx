"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Shown while Cloud is on and the email address isn't confirmed (needed before a community goes public). */
export function ConfirmEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  return (
    <p role="status" className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <span>
        Confirm your email (<span className="font-medium">{email}</span>) to make a community public.
      </span>
      <button
        className="btn-ghost px-2 py-1 text-xs"
        disabled={state === "sending" || state === "sent"}
        onClick={async () => {
          setState("sending");
          const { error } = await supabaseBrowser().auth.resend({ type: "signup", email });
          setState(error ? "failed" : "sent");
        }}
      >
        {state === "sent" ? "Link sent" : state === "sending" ? "Sending…" : state === "failed" ? "Try again" : "Resend link"}
      </button>
    </p>
  );
}
