"use client";

import Link from "next/link";
import { useActionState } from "react";
import { sendReset, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(sendReset, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="text-sm text-signal">
          {state.notice}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "One sec…" : state.notice ? "Send again" : "Send reset link"}
      </button>
      <p className="text-center text-sm text-muted">
        Remembered it?{" "}
        <Link className="text-fg underline" href="/login?mode=signin">
          Sign in
        </Link>
      </p>
    </form>
  );
}
