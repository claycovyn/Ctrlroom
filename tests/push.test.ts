import { describe, expect, it } from "vitest";
import {
  buildPayload,
  drainOutbox,
  isGone,
  MAX_PAYLOAD_BYTES,
  parseSubscription,
  pushSupport,
  safePushUrl,
  secretMatches,
  vapidKeyBytes,
  type DrainDeps,
  type OutboxRow,
  type SendResult,
  type StoredSubscription,
} from "@/lib/push";

const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const sub = (endpoint = "https://fcm.googleapis.com/fcm/send/abc123") => ({ endpoint, expirationTime: null, keys: { p256dh: KEY, auth: AUTH } });

describe("parseSubscription", () => {
  it("accepts a real PushSubscription.toJSON()", () => {
    expect(parseSubscription(sub())).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/abc123", p256dh: KEY, auth: AUTH });
    expect(parseSubscription(sub("https://web.push.apple.com/QK7x"))?.endpoint).toBe("https://web.push.apple.com/QK7x");
  });
  it("refuses anything else", () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("https://x.example")).toBeNull();
    expect(parseSubscription({ endpoint: "https://x.example/a" })).toBeNull();
    expect(parseSubscription(sub("http://insecure.example/a"))).toBeNull();
    expect(parseSubscription(sub("javascript:alert(1)"))).toBeNull();
    expect(parseSubscription(sub("https://x.example/a b"))).toBeNull();
    expect(parseSubscription(sub(`https://x.example/${"a".repeat(1000)}`))).toBeNull();
    expect(parseSubscription({ ...sub(), keys: { p256dh: "short", auth: AUTH } })).toBeNull();
    expect(parseSubscription({ ...sub(), keys: { p256dh: KEY, auth: "not base64url!" } })).toBeNull();
    expect(parseSubscription({ ...sub(), keys: { p256dh: KEY } })).toBeNull();
  });
});

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  user_id: "u1",
  kind: "mention",
  title: "Ann mentioned you in #general",
  body: "hey @ben ship it?",
  url: "/c/demo/general?m=1",
  tag: "room:r1",
  created_at: "2026-10-12T10:00:00.000Z",
  ...over,
});

describe("buildPayload", () => {
  it("carries what the service worker shows", () => {
    expect(JSON.parse(buildPayload(row()))).toEqual({
      title: "Ann mentioned you in #general",
      body: "hey @ben ship it?",
      url: "/c/demo/general?m=1",
      tag: "room:r1",
      kind: "mention",
      at: Date.parse("2026-10-12T10:00:00.000Z"),
    });
  });
  it("keeps links on this site", () => {
    expect(safePushUrl("/c/a/b")).toBe("/c/a/b");
    expect(safePushUrl("https://evil.example")).toBe("/app");
    expect(safePushUrl("//evil.example")).toBe("/app");
    expect(safePushUrl("/\\evil.example")).toBe("/app");
    expect(JSON.parse(buildPayload(row({ url: "javascript:alert(1)" }))).url).toBe("/app");
  });
  it("collapses whitespace, clips long text and stays under the push size limit", () => {
    const p = JSON.parse(buildPayload(row({ title: "  a\n\nb  ", body: "x".repeat(5000) })));
    expect(p.title).toBe("a b");
    expect(p.body.length).toBeLessThanOrEqual(240);
    expect(p.body.endsWith("…")).toBe(true);
    const wide = buildPayload(row({ body: "😀".repeat(2000), title: "😀".repeat(500) }));
    expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });
  it("makes the link absolute with the site address (NEXT_PUBLIC_SITE_URL), and only that", () => {
    expect(JSON.parse(buildPayload(row(), "https://openctrlroom.app")).url).toBe("https://openctrlroom.app/c/demo/general?m=1");
    expect(JSON.parse(buildPayload(row(), "https://www.openctrlroom.app/")).url).toBe("https://www.openctrlroom.app/c/demo/general?m=1");
    expect(JSON.parse(buildPayload(row({ url: "//evil.example" }), "https://openctrlroom.app")).url).toBe("https://openctrlroom.app/app");
    expect(JSON.parse(buildPayload(row(), "javascript:alert(1)")).url).toBe("/c/demo/general?m=1");
    expect(JSON.parse(buildPayload(row(), "https://openctrlroom.app/evil path")).url).toBe("/c/demo/general?m=1");
  });
  it("never sends an empty title", () => {
    expect(JSON.parse(buildPayload(row({ title: "   " }))).title).toBe("Ctrl Room");
  });
});

describe("isGone", () => {
  it("404 and 410 mean the subscription is dead; nothing else does", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    for (const c of [undefined, 400, 401, 403, 413, 429, 500, 503]) expect(isGone(c)).toBe(false);
  });
});

/** An in-memory outbox and device list, with a sender scripted per endpoint. */
function fake(rows: OutboxRow[], subs: StoredSubscription[], script: Record<string, SendResult | "throw">) {
  const outbox = new Map(rows.map((r) => [r.id, { ...r, claimed: false }]));
  const devices = [...subs];
  const sent: { endpoint: string; payload: string }[] = [];
  const finishes: { done: number[]; ok: string[]; gone: string[] }[] = [];
  const deps: DrainDeps = {
    claim: async (limit) => {
      const out = [...outbox.values()].filter((r) => !r.claimed).slice(0, limit);
      out.forEach((r) => (r.claimed = true));
      return out.map(({ claimed: _c, ...r }) => r);
    },
    subscriptionsFor: async (ids) => devices.filter((d) => ids.includes(d.user_id)),
    send: async (d, payload) => {
      const s = script[d.endpoint] ?? { ok: true };
      if (s === "throw") throw new Error("network");
      if (s.ok) sent.push({ endpoint: d.endpoint, payload });
      return s;
    },
    finish: async (done, ok, gone) => {
      finishes.push({ done, ok, gone });
      done.forEach((id) => outbox.delete(id));
      for (const g of gone) devices.splice(devices.findIndex((d) => d.endpoint === g), 1);
    },
  };
  return { deps, outbox, devices, sent, finishes };
}
const dev = (user_id: string, endpoint: string): StoredSubscription => ({ user_id, endpoint, p256dh: KEY, auth: AUTH });

describe("drainOutbox", () => {
  it("sends every row to every device of its person and clears the outbox", async () => {
    const f = fake([row({ id: 1, user_id: "u1" }), row({ id: 2, user_id: "u2" })], [dev("u1", "https://p/a"), dev("u1", "https://p/b"), dev("u2", "https://p/c")], {});
    const r = await drainOutbox(f.deps);
    expect(r).toEqual({ claimed: 2, sent: 3, gone: 0, failed: 0 });
    expect(f.sent.map((s) => s.endpoint).sort()).toEqual(["https://p/a", "https://p/b", "https://p/c"]);
    expect(f.outbox.size).toBe(0);
    expect(f.finishes[0].ok.sort()).toEqual(["https://p/a", "https://p/b", "https://p/c"]);
  });

  it("deletes subscriptions that answer 404 or 410, and finishes rows whose devices are all gone", async () => {
    const f = fake([row({ id: 1 })], [dev("u1", "https://p/gone410"), dev("u1", "https://p/gone404")], {
      "https://p/gone410": { ok: false, statusCode: 410 },
      "https://p/gone404": { ok: false, statusCode: 404 },
    });
    const r = await drainOutbox(f.deps);
    expect(r).toMatchObject({ sent: 0, gone: 2, failed: 0 });
    expect(f.finishes[0].gone.sort()).toEqual(["https://p/gone404", "https://p/gone410"]);
    expect(f.devices).toEqual([]);
    expect(f.outbox.size).toBe(0);
  });

  it("keeps a row for retry when its only device failed for another reason (5xx, network)", async () => {
    const f = fake([row({ id: 1 }), row({ id: 2, user_id: "u2" })], [dev("u1", "https://p/down"), dev("u2", "https://p/boom")], {
      "https://p/down": { ok: false, statusCode: 503 },
      "https://p/boom": "throw",
    });
    const r = await drainOutbox(f.deps);
    expect(r).toMatchObject({ sent: 0, gone: 0, failed: 2 });
    expect([...f.outbox.keys()].sort()).toEqual([1, 2]);
    expect(f.finishes[0]).toEqual({ done: [], ok: [], gone: [] });
    expect(f.devices.length).toBe(2);
  });

  it("one working device is enough; a gone sibling is still removed", async () => {
    const f = fake([row({ id: 1 })], [dev("u1", "https://p/ok"), dev("u1", "https://p/gone"), dev("u1", "https://p/down")], {
      "https://p/gone": { ok: false, statusCode: 410 },
      "https://p/down": { ok: false, statusCode: 500 },
    });
    await drainOutbox(f.deps);
    expect(f.outbox.size).toBe(0);
    expect(f.finishes[0].gone).toEqual(["https://p/gone"]);
    expect(f.finishes[0].ok).toEqual(["https://p/ok"]);
  });

  it("finishes rows for people with no devices left", async () => {
    const f = fake([row({ id: 7, user_id: "nobody" })], [], {});
    expect(await drainOutbox(f.deps)).toMatchObject({ claimed: 1, sent: 0 });
    expect(f.finishes[0].done).toEqual([7]);
  });

  it("works in rounds until the outbox is empty, and stops at the round limit", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ id: i + 1 }));
    const f = fake(rows, [dev("u1", "https://p/a")], {});
    expect((await drainOutbox(f.deps, { limit: 10 })).claimed).toBe(25);
    expect(f.finishes.length).toBe(3);
    const g = fake(rows, [dev("u1", "https://p/a")], {});
    expect((await drainOutbox(g.deps, { limit: 10, rounds: 1 })).claimed).toBe(10);
    expect(g.outbox.size).toBe(15);
  });

  it("stops early on an empty outbox", async () => {
    const f = fake([], [], {});
    expect(await drainOutbox(f.deps)).toEqual({ claimed: 0, sent: 0, gone: 0, failed: 0 });
    expect(f.finishes.length).toBe(0);
  });
});

describe("pushSupport", () => {
  const env = {
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    maxTouchPoints: 0,
  };
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  it("iPhone Safari in a tab must add to Home Screen first", () => {
    expect(pushSupport({ ...env, userAgent: IPHONE, hasPushManager: false })).toBe("ios-install");
    expect(pushSupport({ ...env, userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe("ios-install");
  });
  it("the Home Screen app can subscribe", () => {
    expect(pushSupport({ ...env, userAgent: IPHONE, standalone: true })).toBe("supported");
  });
  it("an old iPhone Home Screen app without PushManager is unsupported", () => {
    expect(pushSupport({ ...env, userAgent: IPHONE, standalone: true, hasPushManager: false })).toBe("unsupported");
  });
  it("desktop Safari on a Mac and Chrome on Android are supported", () => {
    expect(pushSupport({ ...env, userAgent: IPAD_AS_MAC })).toBe("supported");
    expect(pushSupport({ ...env, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile" })).toBe("supported");
    expect(pushSupport({ ...env, userAgent: "x", hasServiceWorker: false })).toBe("unsupported");
  });
});

describe("vapidKeyBytes", () => {
  it("decodes a base64url P-256 public key to 65 bytes starting with 0x04", () => {
    const b = vapidKeyBytes(KEY);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4);
  });
});

describe("secretMatches", () => {
  const S = "a".repeat(64);
  it("needs the exact bearer secret", () => {
    expect(secretMatches(`Bearer ${S}`, S)).toBe(true);
    expect(secretMatches(`Bearer ${S}x`, S)).toBe(false);
    expect(secretMatches(`Bearer ${"b".repeat(64)}`, S)).toBe(false);
    expect(secretMatches(S, S)).toBe(false);
    expect(secretMatches(null, S)).toBe(false);
  });
  it("is off without a long enough secret", () => {
    expect(secretMatches("Bearer ", "")).toBe(false);
    expect(secretMatches("Bearer short", "short")).toBe(false);
    expect(secretMatches("Bearer x", undefined)).toBe(false);
  });
});
