"use client";

import { useEffect, useState } from "react";
import { dismissPrompt, enablePush, promptDismissed, PUSH_MOMENT, readPushState, takeJoinedNote } from "@/lib/pushClient";
import { InstallSteps } from "./InstallSteps";

type Ask = "push" | "install";

/**
 * A one-time, gentle ask to turn on notifications: shown a moment after you send a message or join a community,
 * never on page load, and never again once answered (Settings → Notifications has the switch). On iPhone Safari in a
 * tab it explains Add to Home Screen instead, since that's the only way iOS gives web apps notifications.
 */
export function PushPrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const consider = () => {
      if (promptDismissed() || timer) return;
      timer = setTimeout(async () => {
        const s = await readPushState();
        if (promptDismissed()) return;
        if (s.support === "ios-install") setAsk("install");
        else if (s.support === "supported" && s.permission === "default" && !s.subscribed) setAsk("push");
      }, 1200);
    };
    window.addEventListener(PUSH_MOMENT, consider);
    if (takeJoinedNote()) consider();
    return () => {
      window.removeEventListener(PUSH_MOMENT, consider);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!ask) return null;
  const close = () => {
    dismissPrompt();
    setAsk(null);
  };

  return (
    <div role="dialog" aria-labelledby="push-ask-title" className="cr-toast cr-toast-top flex-col !items-stretch gap-3 p-4">
      {ask === "install" ? (
        <>
          <p id="push-ask-title" className="font-medium">
            Add Ctrl Room to your Home Screen to get notifications
          </p>
          <InstallSteps />
          <div className="flex justify-end">
            <button className="btn-primary px-3 py-1.5 text-sm" onClick={close}>
              Got it
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <p id="push-ask-title" className="font-medium">
              Get notified when someone needs you?
            </p>
            <p className="mt-0.5 text-sm text-muted">Mentions, replies to you, direct messages and calls. Nothing else. Change it any time in Settings.</p>
          </div>
          {error && (
            <p role="alert" className="text-xs text-alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={close}>
              Not now
            </button>
            <button
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const err = await enablePush();
                setBusy(false);
                if (err) return setError(err);
                close();
              }}
            >
              {busy ? "Turning on…" : "Turn on"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
