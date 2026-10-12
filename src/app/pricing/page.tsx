import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { amountLine, CLOUD, CLOUD_PRICE_LABEL } from "@/lib/cloud";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Ctrl Room is free to self-host. Hosted: start free, or get every OpenCtrl original with OPENCTRL Cloud.",
};

export default function Pricing() {
  const meters = Object.keys(CLOUD.meters);
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/">
          <Logo className="h-7 w-auto sm:h-8" />
        </Link>
        <Link href="/login?mode=signup" className="btn-primary">
          Get started
        </Link>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">The software is free.</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Every feature is in every plan: full history, search, threads, boards, voice and video. You only pay if you want
          it run for you, and you can export everything at any time.
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <Plan name="Self-host" price="$0" note="forever" cta={{ href: "/source", label: "Get the code" }}>
            <li>Every feature, no limits</li>
            <li>Your server, your data</li>
            <li>Open source (AGPL-3.0)</li>
          </Plan>
          <Plan name="Free Cloud" price="$0" cta={{ href: "/login?mode=signup", label: "Start free", primary: true }}>
            {meters.filter((k) => (CLOUD.free[k] ?? 0) > 0).map((k) => (
              <li key={k}>{amountLine(k, CLOUD.free[k])}, across the communities you own</li>
            ))}
            <li>Every feature, unlimited members and communities</li>
            <li>At a limit, new messages or calls pause until the month resets. History, search and export keep working, and nothing is deleted.</li>
          </Plan>
          <Plan name="OPENCTRL Cloud" price={CLOUD_PRICE_LABEL.replace("/month", "")} note="a month" highlight cta={{ label: "Coming soon" }}>
            <li className="font-medium">Every hosted OpenCtrl original, one subscription.</li>
            {meters.map((k) => (
              <li key={k}>Up to {amountLine(k, CLOUD.fair_use[k])} in Ctrl Room (fair use)</li>
            ))}
            <li>Never paused. Heavy use? Add a pack ({CLOUD.packs.map((p) => p.label).join(", ")}) instead of hitting a wall.</li>
            <li>Founding members keep this price for as long as they stay subscribed.</li>
          </Plan>
        </div>
        <p className="mt-8 text-sm text-muted">
          Accounts made before hosted plans started keep no limits. Prices in USD.
        </p>
      </section>
    </main>
  );
}

function Plan({
  name,
  price,
  note,
  highlight,
  cta,
  children,
}: {
  name: string;
  price: string;
  note?: string;
  highlight?: boolean;
  cta: { href?: string; label: string; primary?: boolean };
  children: React.ReactNode;
}) {
  return (
    <section className={`card flex flex-col p-6 ${highlight ? "border-2 border-signal" : ""}`}>
      <h2 className="text-lg font-semibold">{name}</h2>
      <p className="mt-1 text-4xl font-semibold">
        {price}
        {note && <span className="text-base font-normal text-muted"> {note}</span>}
      </p>
      <ul className="mb-6 mt-5 space-y-2 text-sm">{children}</ul>
      {cta.href ? (
        <a href={cta.href} className={`${cta.primary ? "btn-primary" : "btn-outline"} mt-auto justify-center`}>
          {cta.label}
        </a>
      ) : (
        <span className="btn-outline mt-auto justify-center opacity-70">{cta.label}</span>
      )}
    </section>
  );
}
