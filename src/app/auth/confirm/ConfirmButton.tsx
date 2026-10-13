"use client";

import { useFormStatus } from "react-dom";

export function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary w-full" disabled={pending}>
      {pending ? "One sec…" : label}
    </button>
  );
}
