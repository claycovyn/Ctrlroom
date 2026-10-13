import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { siteUrl } from "@/lib/env";
import { drainOutbox, type DrainResult, type OutboxRow, type SendResult, type StoredSubscription } from "@/lib/push";

/** VAPID keys (public one also ships to the browser as NEXT_PUBLIC_VAPID_PUBLIC_KEY). Null until all three are set. */
export function vapidDetails(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { subject, publicKey, privateKey };
}

/** Topic header: at most 32 base64url characters; the push service replaces a pending push with the same topic. */
function topicFor(tag: string): string | undefined {
  const t = tag.replace(/[^A-Za-z0-9_-]/g, "").slice(-32);
  return t || undefined;
}

/**
 * Drains push_outbox with the service-role client (0014: claim_push / finish_push) and sends with web-push.
 * Returns null when push isn't configured (no VAPID keys).
 */
export async function dispatchPush(db: SupabaseClient, opts: { rounds?: number } = {}): Promise<DrainResult | null> {
  const vapid = vapidDetails();
  if (!vapid) return null;
  return drainOutbox(
    {
      site: siteUrl(),
      claim: async (limit) => {
        const { data, error } = await db.rpc("claim_push", { p_limit: limit });
        if (error) throw new Error(`claim_push: ${error.message}`);
        return (data ?? []) as OutboxRow[];
      },
      subscriptionsFor: async (ids) => {
        const { data, error } = await db.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", ids);
        if (error) throw new Error(`push_subscriptions: ${error.message}`);
        return (data ?? []) as StoredSubscription[];
      },
      send: async (sub, payload, row): Promise<SendResult> => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
            TTL: row.kind === "call" ? 120 : 3600,
            urgency: "high",
            topic: topicFor(row.tag),
            timeout: 8000,
            vapidDetails: vapid,
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, statusCode: (e as { statusCode?: number }).statusCode };
        }
      },
      finish: async (done, ok, gone) => {
        const { error } = await db.rpc("finish_push", { p_done: done, p_ok: ok, p_gone: gone });
        if (error) throw new Error(`finish_push: ${error.message}`);
      },
    },
    { rounds: opts.rounds },
  );
}
