"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { SoundSettings } from "@/components/chat/SoundSettings";
import { DmPrivacySettings } from "@/components/dm/DmPrivacySettings";
import { ProfilePhoto } from "@/components/ProfilePhoto";
import { NotificationSettings } from "@/components/push/NotificationSettings";
import { cloudErrorText } from "@/lib/cloudErrors";
import { displayNameProblem } from "@/lib/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PageHeader } from "./PageHeader";
import { useShell } from "./ShellContext";

/** Your name as everyone sees it, in every community and on your profile. */
function DisplayName() {
  const { me } = useShell();
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(me.display_name);
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});
  const changed = name.trim() !== me.display_name;
  return (
    <form
      className="mt-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = displayNameProblem(name);
        if (problem) return setState({ error: problem });
        setState({ busy: true });
        const { error } = await supabaseBrowser().from("profiles").update({ display_name: name.trim() }).eq("id", me.id);
        if (error) return setState({ error: cloudErrorText(error.message) ?? "Couldn't save your name. Try again." });
        setState({ saved: true });
        router.refresh();
      }}
    >
      <label className="label" htmlFor={`${id}-name`}>
        Display name
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={64}
          autoComplete="nickname"
          onChange={(e) => {
            setName(e.target.value);
            setState({});
          }}
        />
        <button className="btn-primary shrink-0" disabled={!changed || state.busy}>
          {state.busy ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="mt-2 text-sm text-muted">
          Saved.
        </p>
      )}
    </form>
  );
}

/**
 * /app/settings: your settings in one place, outside any community. Profile photo and name, notifications, sounds,
 * who can message you, the desktop app, usage (Cloud), and your account. Community settings stay in each community.
 */
export function SettingsPage({ email, usage }: { email: string | null; usage?: React.ReactNode }) {
  const { me } = useShell();
  const router = useRouter();
  return (
    <div>
      <PageHeader title="Settings" sub={`@${me.username}`} />
      <div className="space-y-5 px-4 py-5">
        <section id="profile" className="card p-5" aria-labelledby="profile-title">
          <h2 id="profile-title" className="font-medium">
            Profile
          </h2>
          <p className="mb-4 text-sm text-muted">Your photo and name show next to everything you write, in every community and on your profile.</p>
          <ProfilePhoto profile={me} onChange={() => router.refresh()} />
          <DisplayName />
          <p className="mt-4 text-sm text-muted">
            Bio, private account and public profile:{" "}
            <Link href={`/u/${me.username}`} className="font-medium text-fg underline underline-offset-2">
              edit on your profile
            </Link>
            .
          </p>
        </section>

        {usage}

        <NotificationSettings userId={me.id} />
        <SoundSettings />
        <DmPrivacySettings />

        <section id="desktop" className="card p-5">
          <h2 className="font-medium">Desktop app</h2>
          <p className="mb-3 text-sm text-muted">Ctrl Room in its own window on Windows, macOS or Linux, with the same account.</p>
          <a href="/download" className="btn-outline inline-flex">
            Get the desktop app
          </a>
        </section>

        <section id="account" className="card p-5" aria-labelledby="account-title">
          <h2 id="account-title" className="font-medium">
            Account
          </h2>
          {email && (
            <p className="mt-1 text-sm text-muted">
              Signed in as <span className="font-medium text-fg">{email}</span>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/forgot" className="btn-outline">
              Reset password by email
            </Link>
            <form action="/auth/signout" method="post">
              <button className="btn-ghost">Sign out</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
