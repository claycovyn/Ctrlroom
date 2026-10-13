// The parts of web-push (MPL-2.0, https://github.com/web-push-libs/web-push) that src/lib/pushServer.ts uses.
// Declared here instead of adding @types/web-push.
declare module "web-push" {
  interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  interface RequestOptions {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    timeout?: number;
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
  }
  interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }
  class WebPushError extends Error {
    statusCode: number;
    body: string;
    endpoint: string;
  }
  function sendNotification(subscription: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): Promise<SendResult>;
  function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  const webpush: { sendNotification: typeof sendNotification; generateVAPIDKeys: typeof generateVAPIDKeys; WebPushError: typeof WebPushError };
  export default webpush;
  export { sendNotification, generateVAPIDKeys, WebPushError };
}
