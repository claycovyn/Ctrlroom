import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import manifest from "../openctrl.json";
import {
  callMinutes,
  cleanCosts,
  cleanPacks,
  CLOUD,
  estimateCost,
  noticeFor,
  planOf,
  roomIdFromLiveKit,
  tierOf,
  workspaceStatus,
} from "@/lib/cloud";
import { cloudErrorText } from "@/lib/cloudErrors";
import { parseManifest } from "@/lib/mcp-kit";
import { sendUsageNotices, type OverviewRow } from "@/lib/notices";

const migration = readFileSync(path.join(__dirname, "../supabase/migrations/0003_cloud.sql"), "utf8");

describe("openctrl.json", () => {
  it("is a valid OPENCTRL manifest with a cloud section", () => {
    expect(parseManifest(manifest)).toMatchObject({ ok: true });
    expect(Object.keys(CLOUD.meters).sort()).toEqual(["call_minutes", "messages"]);
  });

  it("declares exactly the metrics the database meters", () => {
    for (const meter of Object.keys(CLOUD.meters)) expect(migration).toContain(`'${meter}'`);
  });

  it("is AGPL like every Original", () => {
    expect(manifest.license).toBe("AGPL-3.0-only");
  });
});

describe("plans and tiers", () => {
  it("maps plans to tiers only while Cloud is on", () => {
    expect(tierOf("free", true)).toBe("free");
    expect(tierOf("cloud", true)).toBe("cloud");
    expect(tierOf("grandfathered", true)).toBe("unlimited");
    expect(tierOf("free", false)).toBe("unlimited");
    expect(tierOf("cloud", false)).toBe("unlimited");
  });

  it("treats unknown or missing plans as grandfathered", () => {
    expect(planOf(undefined)).toBe("grandfathered");
    expect(planOf("pro")).toBe("grandfathered");
    expect(planOf("cloud")).toBe("cloud");
  });

  it("keeps only declared packs, as whole positive numbers", () => {
    expect(cleanPacks({ messages_1m: 2.7, calls_10k: -1, bogus: 5 })).toEqual({ messages_1m: 2 });
  });
});

describe("workspace status", () => {
  const free = { plan: "free", packs: {}, usage: { messages: String(CLOUD.free.messages), call_minutes: 10 } };

  it("pauses only the meter a Free workspace is over", () => {
    const s = workspaceStatus(free, true);
    expect(s.tier).toBe("free");
    expect(s.paused).toEqual(["messages"]);
    expect(s.meters.find((m) => m.meter === "call_minutes")?.state).toBe("ok");
  });

  it("never pauses an OPENCTRL Cloud subscriber, even far over fair use", () => {
    const s = workspaceStatus({ plan: "cloud", packs: {}, usage: { messages: CLOUD.fair_use.messages * 3 } }, true);
    expect(s.meters.find((m) => m.meter === "messages")?.state).toBe("over");
    expect(s.paused).toEqual([]);
  });

  it("packs raise a subscriber's limit", () => {
    const s = workspaceStatus({ plan: "cloud", packs: { messages_1m: 2 }, usage: {} }, true);
    expect(s.meters.find((m) => m.meter === "messages")?.limit).toBe(CLOUD.fair_use.messages + 2 * 1_000_000);
  });

  it("has no limits at all with Cloud off (self-hosted)", () => {
    const s = workspaceStatus(free, false);
    expect(s.tier).toBe("unlimited");
    expect(s.meters.every((m) => m.limit === null)).toBe(true);
    expect(s.paused).toEqual([]);
  });
});

describe("notices", () => {
  it("Free at 100%: says what paused, offers OPENCTRL Cloud, promises nothing was deleted", () => {
    const s = workspaceStatus({ plan: "free", packs: {}, usage: { messages: 10_000 } }, true);
    const m = s.meters.find((x) => x.meter === "messages")!;
    const { subject, text } = noticeFor(s, m, 100);
    expect(subject).toMatch(/reached/);
    expect(text).toMatch(/New messages are paused/);
    expect(text).toMatch(/\$12\/month/);
    expect(text).toMatch(/Nothing has been deleted/);
  });

  it("subscriber at 80%: offers a pack, not an upgrade", () => {
    const s = workspaceStatus({ plan: "cloud", packs: {}, usage: { call_minutes: 8_500 } }, true);
    const m = s.meters.find((x) => x.meter === "call_minutes")!;
    const { text } = noticeFor(s, m, 80);
    expect(text).toMatch(/Add a pack/);
    expect(text).toMatch(/\+10,000 call minutes/);
    expect(text).not.toMatch(/\$12/);
  });
});

describe("sendUsageNotices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function fakeDb(alreadySent: Set<string>) {
    const upserts: unknown[][] = [];
    const db = {
      from: () => ({
        upsert: (rows: { owner_id: string; meter: string; pct: number }[]) => {
          upserts.push(rows);
          const fresh = rows.filter((r) => !alreadySent.has(`${r.owner_id}:${r.meter}:${r.pct}`));
          fresh.forEach((r) => alreadySent.add(`${r.owner_id}:${r.meter}:${r.pct}`));
          return { select: async () => ({ data: fresh.map((r) => ({ pct: r.pct })), error: null }) };
        },
      }),
    };
    return { db: db as never, upserts };
  }

  const row = (over: Partial<OverviewRow>): OverviewRow => ({
    user_id: "u1",
    email: "owner@example.com",
    username: "owner",
    communities: 1,
    email_confirmed: true,
    plan: "free",
    packs: {},
    usage: {},
    ...over,
  });

  it("sends one email when usage jumps past 100%, and never twice", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CTRLROOM_EMAIL_FROM", "Ctrl Room <hi@example.com>");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sent = new Set<string>();
    const { db } = fakeDb(sent);
    const rows = [row({ usage: { messages: 12_000 } })];

    expect(await sendUsageNotices(db, rows, true)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.subject).toMatch(/reached/);
    expect(await sendUsageNotices(db, rows, true)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing with Cloud off or for unlimited accounts", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CTRLROOM_EMAIL_FROM", "Ctrl Room <hi@example.com>");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb(new Set());
    expect(await sendUsageNotices(db, [row({ usage: { messages: 99_999 } })], false)).toBe(0);
    expect(await sendUsageNotices(db, [row({ plan: "grandfathered", usage: { messages: 99_999 } })], true)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("calls", () => {
  it("rounds partial minutes up and ignores nonsense", () => {
    expect(callMinutes(1_000, 1_001)).toBe(1);
    expect(callMinutes(1_000, 1_120)).toBe(2);
    expect(callMinutes(1_000, 1_121)).toBe(3);
    expect(callMinutes(0, 500)).toBe(0);
    expect(callMinutes(2_000, 1_000)).toBe(0);
    expect(callMinutes(1, 1 + 10 * 24 * 3600)).toBe(24 * 60);
  });

  it("only meters Ctrl Room's own LiveKit rooms", () => {
    expect(roomIdFromLiveKit("ctrlroom-0b5c1f8e-8a0a-4d3e-9f5e-1c2d3e4f5a6b")).toBe("0b5c1f8e-8a0a-4d3e-9f5e-1c2d3e4f5a6b");
    expect(roomIdFromLiveKit("someone-else")).toBeNull();
    expect(roomIdFromLiveKit(undefined)).toBeNull();
  });
});

describe("errors, costs and never deleting", () => {
  it("shows database errors written for people, hides the rest", () => {
    expect(cloudErrorText('new row violates... CR: You\'re sending messages very fast.')).toBe("You're sending messages very fast.");
    expect(cloudErrorText("duplicate key value")).toBeNull();
  });

  it("estimates cost to serve from unit costs", () => {
    const costs = cleanCosts({ per1kMessages: "0.5", perCallMinute: 0.001, perEmail: -3, perWorkspace: 0.1 });
    expect(costs.perEmail).toBe(0);
    expect(estimateCost({ messages: 4000, call_minutes: 1000 }, costs)).toBeCloseTo(2 + 1 + 0.1);
  });

  it("no Cloud code path deletes data", () => {
    const sql = migration.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    for (const file of ["src/lib/cloud.ts", "src/lib/notices.ts", "src/app/api/admin/route.ts", "src/app/api/livekit/webhook/route.ts", "src/app/api/cron/usage/route.ts"]) {
      expect(readFileSync(path.join(__dirname, "..", file), "utf8")).not.toMatch(/\.delete\(/);
    }
  });
});
