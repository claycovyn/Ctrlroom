"use client";

/**
 * Push in the browser: turning it on and off for this device, and nudging the server to deliver. The service worker
 * (public/sw.js) shows what arrives. Pure rules live in src/lib/push.ts.
 */

import { parseSubscription, pushSupport, vapidKeyBytes, type PushSupport } from "@/lib/push";
import { supabaseBrowser } from "@/lib/supabase/client";
import { swUrl } from "@/lib/swUrl";

export type PushState =
  | { support: "unsupported" | "ios-install" | "not-configured" }
  | { support: "supported"; permission: NotificationPermission; subscribed: boolean };

let active = false;

/**
 * Pushes are on for this device. The in-tab alerts (new Notification in Sidebar and DmContext) step aside then, or
 * you'd get every mention twice.
 */
export function isPushActive(): boolean {
  return active;
}

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

export function browserPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  return pushSupport({
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}


async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  // In development the worker isn't registered on load; push still needs one (it caches nothing in dev).
  await navigator.serviceWorker.register(swUrl(), { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function readPushState(): Promise<PushState> {
  const support = browserPushSupport();
  if (support !== "supported") return { support };
  if (!vapidPublicKey()) return { support: "not-configured" };
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    subscribed = Boolean(sub);
    if (sub && permission === "granted") void resave(sub);
  } catch {
    subscribed = false;
  }
  active = subscribed && permission === "granted";
  return { support: "supported", permission, subscribed };
}

let resaved = false;

/** Once per page load: re-save this device, so a rotated endpoint or another account's earlier sign-in is fixed. */
async function resave(sub: PushSubscription): Promise<void> {
  if (resaved) return;
  resaved = true;
  const parsed = parseSubscription(sub.toJSON());
  if (!parsed) return;
  await supabaseBrowser().rpc("save_push_subscription", {
    p_endpoint: parsed.endpoint,
    p_p256dh: parsed.p256dh,
    p_auth: parsed.auth,
    p_user_agent: navigator.userAgent.slice(0, 400),
  });
}

/**
 * Must run from a tap (iOS asks only then). Resolves to null on success, or a sentence to show.
 */
export async function enablePush(): Promise<string | null> {
  const key = vapidPublicKey();
  if (!key) return "Notifications aren't set up on this server yet.";
  if (browserPushSupport() === "ios-install") return "Add Ctrl Room to your Home Screen first, then open it from there.";
  if (browserPushSupport() !== "supported") return "This browser can't show notifications.";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied"
      ? "Notifications are blocked for Ctrl Room. Turn them on in your browser or phone settings, then try again."
      : "Notifications weren't turned on.";
  }
  try {
    const reg = await registration();
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) as BufferSource }));
    const parsed = parseSubscription(sub.toJSON());
    if (!parsed) return "This browser gave an unexpected subscription. Try again.";
    const { error } = await supabaseBrowser().rpc("save_push_subscription", {
      p_endpoint: parsed.endpoint,
      p_p256dh: parsed.p256dh,
      p_auth: parsed.auth,
      p_user_agent: navigator.userAgent.slice(0, 400),
    });
    if (error) return "Couldn't save this device. Try again.";
    active = true;
    return null;
  } catch {
    return "Couldn't turn on notifications on this device. Try again.";
  }
}

/** Stops pushes to this device (and forgets it on the server). */
export async function disablePush(): Promise<void> {
  active = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await supabaseBrowser().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // nothing to undo
  }
}

let lastNudge = 0;

/**
 * Asks the server to deliver queued pushes now. The database usually does this itself (pg_net); this covers
 * servers without it. Only after a message that could notify someone: one with an @mention, or (always = true) a
 * thread reply or a direct message.
 */
export function nudgePush(body: string, always: boolean): void {
  if (typeof window === "undefined" || !vapidPublicKey()) return;
  if (!always && !/(^|[^a-zA-Z0-9_])@[a-zA-Z0-9_]{2,32}/.test(body)) return;
  const now = Date.now();
  if (now - lastNudge < 1500) return;
  lastNudge = now;
  // The insert's triggers have committed by the time the insert call resolves.
  fetch("/api/push/dispatch", { method: "POST", keepalive: true, credentials: "same-origin" }).catch(() => {});
}

// ───────────────────────── the gentle prompt ─────────────────────────

const ASK_KEY = "ctrlroom:push-ask";

/** The prompt was answered or dismissed on this device. */
export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(ASK_KEY) !== null;
  } catch {
    return true;
  }
}

export function dismissPrompt(): void {
  try {
    localStorage.setItem(ASK_KEY, String(Date.now()));
  } catch {
    // storage blocked: it asks again next time
  }
}

/** Fired after you send a message or join a community; the prompt (PushPrompt) listens. Never on page load. */
export const PUSH_MOMENT = "ctrlroom:push-moment";
const JOINED_KEY = "ctrlroom:joined-community";

export function markPushMoment(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PUSH_MOMENT));
}

/** Joining navigates away, so it leaves a note for the next page. */
export function noteJoinedCommunity(): void {
  try {
    sessionStorage.setItem(JOINED_KEY, "1");
  } catch {
    // ignore
  }
}

export function takeJoinedNote(): boolean {
  try {
    const v = sessionStorage.getItem(JOINED_KEY);
    sessionStorage.removeItem(JOINED_KEY);
    return v === "1";
  } catch {
    return false;
  }
}
