import Link from "next/link";
import type { MyCloud } from "@/lib/cloudStatus";

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Plan and this month's usage for a community owner. Renders nothing when nothing is limited
 * (Cloud off, or an early or self-hosted account). Meters with a 0 limit on a plan are hidden, not shown as full.
 */
export function UsageCard({ cloud }: { cloud: MyCloud }) {
  const { status } = cloud;
  if (!cloud.enabled || status.tier === "unlimited") return null;
  const shown = status.meters.filter((m) => m.limit !== null && m.limit > 0);
  if (!shown.length) return null;
  const resets = new Date(status.resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const free = status.tier === "free";
  const anyOver = shown.some((m) => m.state === "over");
  const anyWarn = shown.some((m) => m.state !== "ok");

  return (
    <section className={`card p-5 ${free && anyOver ? "border-alert/60" : ""}`} aria-labelledby="usage-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-title" className="font-medium">
          {status.planName} · usage this month
        </h2>
        <p className="text-xs text-muted">
          Across the {cloud.owns === 1 ? "community" : `${cloud.owns} communities`} you own · resets {resets}
        </p>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {shown.map((m) => {
          const pct = Math.min(100, Math.round(((m.used / (m.limit ?? 1)) * 100)));
          const bar = m.state === "over" && free ? "bg-alert" : "bg-signal";
          return (
            <li key={m.meter} className="text-sm">
              <p>
                <span className="font-medium">{m.unit.charAt(0).toUpperCase() + m.unit.slice(1)}</span>{" "}
                <span className="text-muted">
                  {fmt(m.used)} of {fmt(m.limit!)}
                </span>
              </p>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-raised"
                role="progressbar"
                aria-valuenow={m.used}
                aria-valuemin={0}
                aria-valuemax={m.limit!}
                aria-label={`${m.unit} used this month`}
              >
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
              </div>
              {m.state === "warn" && <p className="mt-1 text-xs text-muted">Over 80% used.</p>}
              {m.state === "over" && (
                <p className="mt-1 text-xs text-muted">
                  {free
                    ? m.meter === "call_minutes"
                      ? "New calls are paused until it resets. Text keeps working."
                      : "New messages are paused until it resets."
                    : "Over fair use. Everything keeps working."}
                </p>
              )}
              {!free && m.state !== "ok" && cloud.packs[m.meter]?.length ? (
                <p className="mt-1 text-xs text-muted">Add a pack: {cloud.packs[m.meter].join(", ")}.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {free && (
        <p className={`mt-4 text-sm ${anyWarn ? "" : "text-muted"}`}>
          {cloud.upgrade.url ? (
            <a href={cloud.upgrade.url} className="font-medium underline underline-offset-2">
              Join OPENCTRL Cloud for {cloud.upgrade.price}
            </a>
          ) : (
            <>Join OPENCTRL Cloud for {cloud.upgrade.price}</>
          )}
          : every OpenCtrl original, with fair-use limits.{cloud.upgrade.url ? "" : " (Coming soon.)"}{" "}
          <Link href="/pricing" className="underline underline-offset-2">
            Pricing
          </Link>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Nothing is ever deleted for going over. History, search and export always work.</p>
    </section>
  );
}
