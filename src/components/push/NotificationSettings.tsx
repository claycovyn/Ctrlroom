"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, readPushState, type PushState } from "@/lib/pushClient";
import { supabaseBrowser } from "@/lib/supabase/client";
import { InstallSteps } from "./InstallSteps";

interface Prefs {
  mentions: boolean;
  replies: boolean;
  dms: boolean;
  calls: boolean;
  quiet_start: number | null;
  quiet_end: number | null;
  tz: string;
}

const DEFAULTS: Prefs = { mentions: true, replies: true, dms: true, calls: true, quiet_start: null, quiet_end: null, tz: "UTC" };

const KINDS: { key: "mentions" | "replies" | "dms" | "calls"; label: string; hint: string }[] = [
  { key: "mentions", label: "Mentions", hint: "Someone @mentions you." },
  { key: "replies", label: "Replies", hint: "Someone replies to your post." },
  { key: "dms", label: "Direct messages", hint: "New messages and message requests." },
  { key: "calls", label: "Calls", hint: "A call starts in a room you use." },
];

const toTime = (m: number | null) => (m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const fromTime = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Settings → Notifications: this device on or off, and what you're notified about (saved to your account). */
export function NotificationSettings({ userId }: { userId: string }) {
  const [device, setDevice] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    readPushState().then(setDevice);
    supabaseBrowser()
      .from("push_prefs")
      .select("mentions, replies, dms, calls, quiet_start, quiet_end, tz")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data as Prefs);
      });
  }, [userId]);

  const save = async (next: Prefs) => {
    const prev = prefs;
    setPrefs(next);
    setError(null);
    const fields = { ...next, tz: next.quiet_start === null ? next.tz : localZone() };
    const db = supabaseBrowser();
    // Update first (no row yet → insert): an upsert would also try to write user_id, which isn't updatable.
    const { data, error: err } = await db.from("push_prefs").update(fields).eq("user_id", userId).select("user_id");
    const failed = err ?? (!data?.length ? (await db.from("push_prefs").insert({ user_id: userId, ...fields })).error : null);
    if (failed) {
      setPrefs(prev);
      setError("Couldn't save that. Try again.");
      return;
    }
    setSaved("Saved");
    setTimeout(() => setSaved(null), 1500);
  };

  const on = device?.support === "supported" && device.subscribed && device.permission === "granted";
  const quiet = prefs.quiet_start !== null;
  const permission = device?.support === "supported" ? device.permission : "default";

  return (
    <section id="notifications" className="card p-5">
      <h2 className="font-medium">Notifications</h2>
      <p className="mb-4 text-sm text-muted">
        Notifications on your phone or computer, even when Ctrl Room is closed. Muted rooms and conversations never notify.
      </p>

      {!device ? (
        <p className="text-sm text-muted">Checking this device…</p>
      ) : device.support === "ios-install" ? (
        <div className="rounded-lg border border-line bg-raised/40 p-4">
          <p className="mb-3 text-sm font-medium">Add Ctrl Room to your Home Screen to get notifications</p>
          <InstallSteps />
          <p className="mt-3 text-xs text-muted">Apple allows web notifications only for apps on the Home Screen (iOS 16.4 or later).</p>
        </div>
      ) : device.support === "unsupported" ? (
        <p className="text-sm text-muted">This browser can&apos;t show notifications. Try Safari on iPhone (from the Home Screen), Chrome, Edge or Firefox.</p>
      ) : device.support === "not-configured" ? (
        <p className="text-sm text-muted">Notifications aren&apos;t set up on this server yet.</p>
      ) : (
        <div>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Notifications on this device</span>
              {permission === "denied" && (
                <span className="block text-xs text-muted">
                  Blocked in your settings. Allow notifications for Ctrl Room there (iPhone: Settings → Notifications → Ctrl Room), then
                  come back.
                </span>
              )}
            </span>
            <input
              type="checkbox"
              role="switch"
              className="h-5 w-5 shrink-0 accent-[rgb(var(--signal))]"
              checked={on}
              disabled={busy || permission === "denied"}
              aria-label="Notifications on this device"
              onChange={async (e) => {
                setBusy(true);
                setError(null);
                if (e.target.checked) setError(await enablePush());
                else await disablePush();
                setDevice(await readPushState());
                setBusy(false);
              }}
            />
          </label>
        </div>
      )}

      <fieldset className={`mt-5 ${device?.support === "supported" ? "" : "opacity-70"}`}>
        <legend className="label">Notify me about</legend>
        <ul className="divide-y divide-line rounded-md border border-line">
          {KINDS.map((k) => (
            <li key={k.key} className="flex items-center gap-3 px-3 py-2.5">
              <input
                id={`push-${k.key}`}
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[rgb(var(--signal))]"
                checked={prefs[k.key]}
                onChange={(e) => save({ ...prefs, [k.key]: e.target.checked })}
              />
              <label htmlFor={`push-${k.key}`} className="min-w-0 flex-1">
                <span className="block text-sm">{k.label}</span>
                <span className="block text-xs text-muted">{k.hint}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="mt-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-[rgb(var(--signal))]"
            checked={quiet}
            onChange={(e) => save(e.target.checked ? { ...prefs, quiet_start: 22 * 60, quiet_end: 7 * 60 } : { ...prefs, quiet_start: null, quiet_end: null })}
          />
          <span className="text-sm">Quiet hours</span>
        </label>
        {quiet && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-sm">
            <label className="sr-only" htmlFor="quiet-from">
              From
            </label>
            <input
              id="quiet-from"
              type="time"
              className="input w-32"
              value={toTime(prefs.quiet_start)}
              onChange={(e) => {
                const v = fromTime(e.target.value);
                if (v !== null) save({ ...prefs, quiet_start: v });
              }}
            />
            <span className="text-muted">to</span>
            <label className="sr-only" htmlFor="quiet-to">
              To
            </label>
            <input
              id="quiet-to"
              type="time"
              className="input w-32"
              value={toTime(prefs.quiet_end)}
              onChange={(e) => {
                const v = fromTime(e.target.value);
                if (v !== null) save({ ...prefs, quiet_end: v });
              }}
            />
            <span className="text-xs text-muted">{prefs.tz}</span>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        Notifications use your device&apos;s own sound. Do not disturb in Ctrl Room quiets the app&apos;s sounds only; for your phone, use quiet
        hours or Focus. Saved to your account, for every device.
      </p>
      {(error || saved) && (
        <p role={error ? "alert" : "status"} className={`mt-2 text-xs ${error ? "text-alert" : "text-muted"}`}>
          {error ?? saved}
        </p>
      )}
    </section>
  );
}
