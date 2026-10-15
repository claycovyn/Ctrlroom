"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PASSWORD_MIN } from "@/lib/authLinks";
import { signIn, signUp, type AuthState } from "./actions";

export function AuthForm({ mode, next }: { mode: "signin" | "signup"; next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signup" ? signUp : signIn, {});
  const q = next !== "/app" ? `&next=${encodeURIComponent(next)}` : "";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {mode === "signup" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="display_name">
              Display name
            </label>
            <input id="display_name" name="display_name" className="input" autoComplete="nickname" required />
          </div>
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              className="input"
              autoComplete="username"
              pattern="[A-Za-z0-9_]{2,32}"
              title="2–32 letters, numbers or underscores"
              required
            />
          </div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            Password
          </label>
          {mode === "signin" && (
            <Link className="mb-1 text-xs text-muted underline hover:text-fg" href="/forgot">
              Forgot password?
            </Link>
          )}
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? PASSWORD_MIN : undefined}
          required
        />
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
      <button className="btn-primary h-11 w-full rounded-full text-[15px] font-semibold" disabled={pending}>
        {pending ? "One sec…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link className="text-fg underline" href={`/login?mode=signin${q}`}>
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="text-fg underline" href={`/login?mode=signup${q}`}>
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
