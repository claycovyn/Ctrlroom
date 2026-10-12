"use client";

import { useActionState, useState } from "react";
import { slugify } from "@/lib/format";
import { createCommunity, joinCommunity, type FormState } from "./actions";

export function CreateCommunityForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createCommunity, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const shown = touched ? slug : slugify(name);

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-[4rem_1fr] gap-3">
        <div>
          <label className="label" htmlFor="icon">
            Icon
          </label>
          <input id="icon" name="icon" className="input text-center" placeholder="⚡" maxLength={8} />
        </div>
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="input"
            placeholder="OpenCtrl"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="slug">
          Link
        </label>
        <div className="flex items-center rounded-md border border-line bg-bg pl-3 text-sm focus-within:border-signal">
          <span className="text-muted">/c/</span>
          <input
            id="slug"
            name="slug"
            className="w-full bg-transparent px-1 py-2 focus:outline-none"
            value={shown}
            onChange={(e) => {
              setTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="description">
          What’s it for?
        </label>
        <input id="description" name="description" className="input" maxLength={280} placeholder="Optional" />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Setting it up…" : "Create community"}
      </button>
    </form>
  );
}

export function JoinCommunityForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(joinCommunity, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="code">
          Invite link or code
        </label>
        <input id="code" name="code" className="input" placeholder="https://…/invite/abc123" required />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      )}
      <button className="btn-outline w-full" disabled={pending}>
        {pending ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
