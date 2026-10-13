"use client";

import { useActionState } from "react";
import { PASSWORD_MIN } from "@/lib/authLinks";
import { setPassword, type ResetState } from "./actions";

export function ResetForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setPassword, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </div>
      <p className="text-xs text-muted">At least {PASSWORD_MIN} characters.</p>
      {state.error && (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "One sec…" : "Save password"}
      </button>
    </form>
  );
}
