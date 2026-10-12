// OPENCTRL Cloud for Ctrl Room: plans, limits and usage, from the `cloud` section of openctrl.json.
// Pure (no database, no secrets), so pages, routes and tests share one source of truth. Enforcement lives in
// the database (supabase/migrations/0003_cloud.sql); this file decides what people see.
import manifestJson from "../../openctrl.json";
import { cloudSchema, entitlementLimits, packsFor, usageStatus, type MeterStatus, type Tier } from "@/lib/mcp-kit";

export const CLOUD = cloudSchema.parse(manifestJson.cloud);

export const CLOUD_PRICE_LABEL = "$12/month";

export type PlanId = "free" | "cloud" | "grandfathered";

export const PLANS: Record<PlanId, { name: string; priceCents: number; tier: Tier }> = {
  free: { name: "Free Cloud", priceCents: 0, tier: "free" },
  cloud: { name: "OPENCTRL Cloud", priceCents: 1200, tier: "cloud" },
  grandfathered: { name: "Early account", priceCents: 0, tier: "unlimited" },
};

/** CTRLROOM_CLOUD=1 turns limits on. Without it (every self-hosted install) nothing is ever limited. */
export function cloudEnabled(): boolean {
  return process.env.CTRLROOM_CLOUD === "1";
}

export function planOf(value: unknown): PlanId {
  return value === "free" || value === "cloud" ? value : "grandfathered";
}

export function tierOf(plan: PlanId, enabled: boolean): Tier {
  return enabled ? PLANS[plan].tier : "unlimited";
}

/** Pack quantities by pack id, keeping only packs the manifest declares. */
export function cleanPacks(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const p of CLOUD.packs) {
    const n = Math.floor(Number((value as Record<string, unknown>)[p.id]));
    if (Number.isFinite(n) && n > 0) out[p.id] = Math.min(n, 1000);
  }
  return out;
}

/** What my_cloud_status() (or one row of cloud_admin_overview()) returns. */
export interface CloudStatusRow {
  enabled?: boolean;
  plan: string;
  packs: unknown;
  usage: Record<string, number | string>;
  resets?: string;
}

export interface WorkspaceStatus {
  plan: PlanId;
  planName: string;
  tier: Tier;
  meters: MeterStatus[];
  /** Meters whose new activity is paused (Free tier only). */
  paused: string[];
  packs: Record<string, number>;
  resetsAt: string;
}

export function nextMonthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** "November 1": the day monthly meters reset (UTC); by default the next one. */
export function resetLabel(resetsAt: string = nextMonthStart()): string {
  return new Date(resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function workspaceStatus(row: CloudStatusRow, enabled = row.enabled ?? false): WorkspaceStatus {
  const plan = planOf(row.plan);
  const tier = tierOf(plan, enabled);
  const packs = cleanPacks(row.packs);
  const used: Record<string, number> = {};
  for (const [k, v] of Object.entries(row.usage ?? {})) used[k] = Number(v) || 0;
  const meters = usageStatus(CLOUD, entitlementLimits(CLOUD, tier, packs), used);
  return {
    plan,
    planName: PLANS[plan].name,
    tier,
    meters,
    paused: tier === "free" ? meters.filter((m) => m.state === "over").map((m) => m.meter) : [],
    packs,
    resetsAt: row.resets ? new Date(row.resets).toISOString() : nextMonthStart(),
  };
}

export function meterLabel(meter: string): string {
  const unit = CLOUD.meters[meter]?.unit ?? meter;
  return unit.charAt(0).toUpperCase() + unit.slice(1);
}

export function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "10,000 messages a month" */
export function amountLine(meter: string, amount: number): string {
  const m = CLOUD.meters[meter];
  return `${formatAmount(amount)} ${m?.unit ?? meter}${m?.period === "month" ? " a month" : ""}`;
}

export function packOffer(meter: string): string[] {
  return packsFor(CLOUD, meter).map((p) => p.label);
}

const FREE_UPGRADE = `Join OPENCTRL Cloud for ${CLOUD_PRICE_LABEL}: every OpenCtrl original, with fair-use limits.`;

/** The 80% / 100% notice for one meter. */
export function noticeFor(status: WorkspaceStatus, m: MeterStatus, pct: 80 | 100): { subject: string; text: string } {
  const what = m.unit;
  const resets = resetLabel(status.resetsAt);
  const lines: string[] = [];
  if (pct === 100) {
    lines.push(
      status.tier === "free"
        ? `Your communities on Ctrl Room have used this month's free ${what} (${formatAmount(m.used)} of ${formatAmount(m.limit ?? 0)}). New ${what} are paused until ${resets}.`
        : `Your communities on Ctrl Room are past the fair-use amount for ${what} this month (${formatAmount(m.used)} of ${formatAmount(m.limit ?? 0)}). Everything keeps working.`,
    );
  } else {
    lines.push(`Your communities on Ctrl Room have used ${Math.floor(m.pct ?? 0)}% of this month's ${what} (${formatAmount(m.used)} of ${formatAmount(m.limit ?? 0)}). The count resets on ${resets}.`);
  }
  if (status.tier === "free") lines.push(FREE_UPGRADE);
  else {
    const packs = packOffer(m.meter);
    if (packs.length) lines.push(`Add a pack to raise it: ${packs.join(", ")}.`);
  }
  lines.push("Nothing has been deleted. History, search and export always work.");
  return {
    subject: pct === 100 ? `Ctrl Room: you've reached your ${what} for this month` : `Ctrl Room: 80% of your ${what} used`,
    text: lines.join("\n\n"),
  };
}

export const UPGRADE_TEXT = FREE_UPGRADE;

/** Billable minutes for one person's time in a call (LiveKit timestamps in seconds). Partial minutes round up. */
export function callMinutes(joinedAtSec: number, leftAtSec: number): number {
  if (!Number.isFinite(joinedAtSec) || !Number.isFinite(leftAtSec) || joinedAtSec <= 0 || leftAtSec <= joinedAtSec) return 0;
  return Math.min(Math.ceil((leftAtSec - joinedAtSec) / 60), 24 * 60);
}

/** LiveKit room names are "ctrlroom-<room uuid>" (see /api/livekit/token). */
export function roomIdFromLiveKit(name: string | undefined): string | null {
  const m = /^ctrlroom-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(name ?? "");
  return m ? m[1] : null;
}

// ── cost to serve (unit costs entered on /admin from the bills)

export interface UnitCosts {
  /** Dollars per 1,000 messages (database rows + realtime fan-out). */
  per1kMessages: number;
  /** Dollars per call minute (LiveKit participant minute). */
  perCallMinute: number;
  /** Dollars per AI answer (model and search calls). */
  perAiReply: number;
  /** Dollars per email sent. */
  perEmail: number;
  /** Fixed dollars per workspace per month (share of hosting). */
  perWorkspace: number;
}

export const DEFAULT_COSTS: UnitCosts = { per1kMessages: 0, perCallMinute: 0, perAiReply: 0, perEmail: 0, perWorkspace: 0 };

export function cleanCosts(value: unknown): UnitCosts {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const n = (k: keyof UnitCosts) => {
    const x = Number(v[k]);
    return Number.isFinite(x) && x >= 0 ? x : 0;
  };
  return { per1kMessages: n("per1kMessages"), perCallMinute: n("perCallMinute"), perAiReply: n("perAiReply"), perEmail: n("perEmail"), perWorkspace: n("perWorkspace") };
}

export function estimateCost(usage: Record<string, number | string>, costs: UnitCosts, emails = 0): number {
  const messages = Number(usage.messages) || 0;
  const minutes = Number(usage.call_minutes) || 0;
  const ai = Number(usage.ai_replies) || 0;
  return (messages / 1000) * costs.per1kMessages + minutes * costs.perCallMinute + ai * costs.perAiReply + emails * costs.perEmail + costs.perWorkspace;
}
