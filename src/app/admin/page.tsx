export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { currentAdmin } from "@/lib/admin";
import { SEARCH_QUOTA_SERVICE, searchConfigured, searchMonthlyLimit } from "@/lib/agent/tools";
import { CLOUD, cleanCosts, cloudEnabled, estimateCost, formatAmount, PLANS, workspaceStatus } from "@/lib/cloud";
import { syncCloudConfig } from "@/lib/cloudSync";
import { emailConfigured } from "@/lib/email";
import type { OverviewRow } from "@/lib/notices";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

interface ReportRow {
  id: string;
  reason: string;
  details: string;
  created_at: string;
  message_id: string | null;
  communities: { slug: string; name: string; taken_down_at: string | null } | null;
  messages: { body: string } | null;
  /** Direct message reports (0011 report_dm): no community; the text as it was when reported. */
  dm_message_id: string | null;
  dm_snapshot: string | null;
  dm_author: { username: string; display_name: string } | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await currentAdmin();
  if (!admin) notFound();
  const sp = await searchParams;
  const db = supabaseAdmin();

  if (!db) {
    return (
      <Shell>
        <p className="card p-5 text-sm">
          Set <code>SUPABASE_SERVICE_ROLE_KEY</code> (Supabase → Project settings → API) to use this page. It&apos;s server only;
          never expose it to the browser.
        </p>
      </Shell>
    );
  }

  const sync = await syncCloudConfig();
  const [{ data: config }, { data: overview }, { data: reports }, { data: takedowns }, { data: costRow }, { data: notices }] = await Promise.all([
    db.from("cloud_config").select("enabled, free, updated_at").eq("id", 1).single(),
    db.rpc("cloud_admin_overview"),
    db
      .from("reports")
      .select("id, reason, details, created_at, message_id, communities(slug, name, taken_down_at), messages(body), dm_message_id, dm_snapshot, dm_author:profiles!reports_dm_author_id_fkey(username, display_name)")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("communities").select("slug, name, taken_down_at, taken_down_reason").not("taken_down_at", "is", null).order("taken_down_at", { ascending: false }),
    db.from("app_settings").select("value").eq("key", "unit_costs").maybeSingle(),
    db.from("cloud_notices").select("owner_id").gte("period", new Date().toISOString().slice(0, 7)),
  ]);

  const searchLimit = searchMonthlyLimit();
  const searchesUsed =
    searchConfigured() && searchLimit !== null ? ((await db.rpc("quota_used", { p_service: SEARCH_QUOTA_SERVICE })).data as number | null) : null;

  const enabled = Boolean(config?.enabled);
  const costs = cleanCosts(costRow?.value);
  const emailsBy = new Map<string, number>();
  for (const n of (notices ?? []) as { owner_id: string }[]) emailsBy.set(n.owner_id, (emailsBy.get(n.owner_id) ?? 0) + 1);
  const rows = ((overview ?? []) as OverviewRow[])
    .map((r) => ({ ...r, status: workspaceStatus(r, enabled), cost: estimateCost(r.usage, costs, emailsBy.get(r.user_id) ?? 0) }))
    .sort((a, b) => b.cost - a.cost || Number(b.usage.messages ?? 0) - Number(a.usage.messages ?? 0));
  const subscribers = rows.filter((r) => r.status.plan === "cloud").length;
  const totalCost = rows.reduce((t, r) => t + r.cost, 0);

  return (
    <Shell>
      {sp.done && <p role="status" className="card px-4 py-3 text-sm">{sp.done}</p>}
      {sp.error && <p role="alert" className="card border-alert/60 px-4 py-3 text-sm text-alert">{sp.error}</p>}

      <section className="card p-5">
        <h2 className="font-medium">OpenCtrl Cloud</h2>
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            Limits: <strong>{enabled ? "on" : "off"}</strong> ({cloudEnabled() ? "CTRLROOM_CLOUD=1" : "CTRLROOM_CLOUD not set, so nobody is limited"})
            {!sync.ok && <span className="text-alert"> · sync failed: {sync.error}</span>}
          </li>
          <li>
            Free tier: {Object.entries(CLOUD.free).map(([k, v]) => `${formatAmount(v)} ${CLOUD.meters[k].unit}`).join(" · ")} a month per owner
          </li>
          <li>Fair use (OpenCtrl Cloud): {Object.entries(CLOUD.fair_use).map(([k, v]) => `${formatAmount(v)} ${CLOUD.meters[k].unit}`).join(" · ")} a month</li>
          <li>
            Email: {emailConfigured() ? "configured (Resend)" : <span className="text-alert">not configured: usage notices aren&apos;t sent (set RESEND_API_KEY and CTRLROOM_EMAIL_FROM)</span>}
          </li>
          <li>Daily notices cron: {process.env.CRON_SECRET ? "CRON_SECRET set" : <span className="text-alert">CRON_SECRET not set, so /api/cron/usage refuses to run</span>}</li>
          {searchConfigured() && (
            <li>
              Web searches this month:{" "}
              {searchLimit === null ? (
                "not metered (set SEARCH_MONTHLY_LIMIT to cap them)"
              ) : searchesUsed === null ? (
                <span className="text-alert">couldn&apos;t read the count, so search is paused (is migration 0005 applied?)</span>
              ) : (
                <span className={searchesUsed >= searchLimit ? "text-alert" : ""}>
                  {searchesUsed} of {searchLimit}
                  {searchesUsed >= searchLimit && ", paused until next month"}
                </span>
              )}
            </li>
          )}
          <li>
            Call minutes: {process.env.LIVEKIT_API_KEY ? "LiveKit keys set; point the LiveKit webhook at /api/livekit/webhook" : "LiveKit not configured"}
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminForm action="sync">
            <button className="btn-outline">Sync now</button>
          </AdminForm>
          <AdminForm action="test-email">
            <button className="btn-outline" disabled={!emailConfigured()}>
              Send me a test email
            </button>
          </AdminForm>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-medium">This month</h2>
        <p className="mt-2 text-sm">
          {rows.length} workspace{rows.length === 1 ? "" : "s"} · {subscribers} on OpenCtrl Cloud · cost to serve {money(totalCost)} (estimate from the
          unit costs below)
        </p>
        <p className="mt-1 text-xs text-muted">
          Revenue isn&apos;t per app: one $12 OpenCtrl Cloud subscription covers every Original, so compare this cost with Ctrl Room&apos;s share.
        </p>
      </section>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 font-medium">Workspaces</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No community owners yet.</p>
        ) : (
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-normal">Owner</th>
                <th className="py-2 pr-3 font-normal">Communities</th>
                {Object.keys(CLOUD.meters).map((k) => (
                  <th key={k} className="py-2 pr-3 font-normal capitalize">{CLOUD.meters[k].unit}</th>
                ))}
                <th className="py-2 pr-3 font-normal">Cost</th>
                <th className="py-2 pr-3 font-normal">Plan</th>
                <th className="py-2 font-normal">Packs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-t border-line align-top">
                  <td className="py-2 pr-3">
                    <div>{r.email}</div>
                    <div className="text-xs text-muted">
                      @{r.username}
                      {!r.email_confirmed && " · email not confirmed"}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{r.communities}</td>
                  {r.status.meters.map((m) => (
                    <td key={m.meter} className={`py-2 pr-3 ${m.state === "over" ? "font-medium text-alert" : ""}`}>
                      {formatAmount(m.used)}
                      {m.limit !== null && <span className="text-xs text-muted"> / {formatAmount(m.limit)}</span>}
                    </td>
                  ))}
                  <td className="py-2 pr-3">{money(r.cost)}</td>
                  <td className="py-2 pr-3">
                    <AdminForm action="plan" className="flex gap-1">
                      <input type="hidden" name="userId" value={r.user_id} />
                      <select name="plan" defaultValue={r.status.plan} className="input py-1 text-xs" aria-label={`Plan for ${r.email}`}>
                        {Object.entries(PLANS).map(([id, p]) => (
                          <option key={id} value={id}>{p.name}</option>
                        ))}
                      </select>
                      <button className="btn-ghost px-2 text-xs">Set</button>
                    </AdminForm>
                  </td>
                  <td className="py-2">
                    <AdminForm action="packs" className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="userId" value={r.user_id} />
                      {CLOUD.packs.map((p) => (
                        <label key={p.id} className="flex items-center gap-1 text-xs" title={p.label}>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            name={`pack_${p.id}`}
                            defaultValue={r.status.packs[p.id] ?? 0}
                            className="input w-14 py-1 text-xs"
                            aria-label={p.label}
                          />
                          {p.id}
                        </label>
                      ))}
                      <button className="btn-ghost px-2 text-xs">Save</button>
                    </AdminForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-muted">Plans and packs are set here by hand until OpenCtrl billing sets them.</p>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-medium">Open reports · {(reports ?? []).length}</h2>
        {(reports ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing to review.</p>
        ) : (
          <ul className="space-y-4">
            {((reports ?? []) as unknown as ReportRow[]).map((r) => (
              <li key={r.id} className="border-t border-line pt-3 text-sm first:border-0 first:pt-0">
                <p>
                  <strong className="capitalize">{r.reason}</strong> ·{" "}
                  {r.dm_message_id || r.dm_snapshot !== null
                    ? `Direct message from ${r.dm_author ? `@${r.dm_author.username}` : "a deleted account"}`
                    : r.communities
                      ? <Link href={`/c/${r.communities.slug}`} className="underline">/c/{r.communities.slug}</Link>
                      : "deleted community"}
                  <span className="text-xs text-muted"> · {new Date(r.created_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</span>
                </p>
                {r.messages && <blockquote className="mt-1 rounded bg-raised px-2 py-1">{r.messages.body || <em>deleted</em>}</blockquote>}
                {r.dm_snapshot !== null && <blockquote className="mt-1 rounded bg-raised px-2 py-1">{r.dm_snapshot || <em>deleted</em>}</blockquote>}
                {r.details && <p className="mt-1 text-muted">“{r.details}”</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.communities && !r.communities.taken_down_at && (
                    <AdminForm action="takedown" className="flex gap-1">
                      <input type="hidden" name="slug" value={r.communities.slug} />
                      <input type="hidden" name="reportId" value={r.id} />
                      <input name="reason" className="input py-1 text-xs" placeholder="Reason shown to members" defaultValue={`Reported for ${r.reason}.`} aria-label="Takedown reason" />
                      <button className="btn-outline px-2 text-xs text-alert">Take down community</button>
                    </AdminForm>
                  )}
                  <AdminForm action="dismiss">
                    <input type="hidden" name="reportId" value={r.id} />
                    <button className="btn-ghost px-2 text-xs">Dismiss</button>
                  </AdminForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-medium">Takedowns</h2>
        <AdminForm action="takedown" className="flex flex-wrap gap-2">
          <input name="slug" className="input w-40" placeholder="community-slug" required aria-label="Community slug" />
          <input name="reason" className="input min-w-[12rem] flex-1" placeholder="Reason shown to members" aria-label="Reason" />
          <button className="btn-outline text-alert">Take down</button>
        </AdminForm>
        <ul className="mt-4 space-y-2 text-sm">
          {(takedowns ?? []).map((t) => (
            <li key={t.slug} className="flex flex-wrap items-center gap-2">
              <span>
                /c/{t.slug} · {t.taken_down_reason}
              </span>
              <AdminForm action="restore">
                <input type="hidden" name="slug" value={t.slug} />
                <button className="btn-ghost px-2 text-xs">Restore</button>
              </AdminForm>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-medium">Unit costs</h2>
        <p className="mt-1 text-sm text-muted">From the Supabase, LiveKit, AI model and Resend bills. They only feed the cost estimate above.</p>
        <AdminForm action="costs" className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["per1kMessages", "Dollars per 1,000 messages"],
              ["perCallMinute", "Dollars per call minute"],
              ["perAiReply", "Dollars per AI answer"],
              ["perEmail", "Dollars per email"],
              ["perGbFiles", "Dollars per GB of chat files"],
              ["perWorkspace", "Fixed dollars per workspace a month"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="text-sm">
              {label}
              <input type="number" step="any" min={0} name={k} defaultValue={costs[k]} className="input mt-1" />
            </label>
          ))}
          <div>
            <button className="btn-primary">Save costs</button>
          </div>
        </AdminForm>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/app">
          <Logo />
        </Link>
        <span className="text-sm text-muted">Operator</span>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-16 sm:px-6">{children}</div>
    </main>
  );
}

function AdminForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  return (
    <form method="post" action="/api/admin" className={className}>
      <input type="hidden" name="action" value={action} />
      {children}
    </form>
  );
}
