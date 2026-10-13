"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserPushSupport, enablePush, readPushState, type PushState } from "@/lib/pushClient";
import { BellIcon } from "./icons";

/**
 * The small "turn on notifications" control at the bottom of the sidebar. With push set up (VAPID keys) it subscribes
 * this device; on iPhone Safari outside the Home Screen app it points to the steps; without push it falls back to
 * the browser's own alerts while the tab is open. Hidden once notifications are on or blocked.
 */
export function NotificationsButton({ settingsHref }: { settingsHref: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [legacy, setLegacy] = useState<NotificationPermission | "unsupported">("unsupported");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readPushState().then(setState);
    setLegacy(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  if (!state) return null;
  const cls = "mx-3 mb-2 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-xs text-muted hover:text-fg";

  if (state.support === "ios-install") {
    return (
      <Link href={`${settingsHref}#notifications`} className={cls}>
        <BellIcon className="h-4 w-4 shrink-0" />
        Get notifications on your iPhone: add Ctrl Room to your Home Screen
      </Link>
    );
  }
  if (state.support === "supported") {
    if (state.subscribed || state.permission === "denied") return null;
    return (
      <div className="mx-3 mb-2">
        <button
          className={`${cls} mx-0 mb-0 w-full`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const err = await enablePush();
            setBusy(false);
            setError(err);
            setState(await readPushState());
          }}
        >
          <BellIcon className="h-4 w-4 shrink-0" />
          {busy ? "Turning on…" : "Turn on notifications for mentions, replies and direct messages"}
        </button>
        {error && (
          <p role="alert" className="mt-1 text-xs text-alert">
            {error}
          </p>
        )}
      </div>
    );
  }
  // No push on this server or browser: the tab's own alerts, as before.
  if (legacy !== "default" || browserPushSupport() === "ios-install") return null;
  return (
    <button className={cls} onClick={async () => setLegacy(await Notification.requestPermission())}>
      <BellIcon className="h-4 w-4 shrink-0" />
      Turn on desktop alerts for mentions, replies and direct messages
    </button>
  );
}
