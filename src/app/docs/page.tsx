import Link from "next/link";
import { loadDocs } from "@/lib/docs";

export default function DocsHome() {
  const apps = loadDocs();
  return (
    <div>
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-muted">OpenCtrl docs</p>
      <h1 className="text-3xl font-semibold tracking-tight">How can we help?</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Guides for every OpenCtrl app. In Ctrl Room you can also ask <strong className="text-fg">@openctrl</strong> in any room. It answers from these pages.
      </p>
      <div className="mt-8 space-y-8">
        {apps.map((a) => (
          <section key={a.slug}>
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <p className="mb-3 text-sm text-muted">{a.tagline}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {a.pages.map((p) => (
                <Link key={p.slug} href={p.url} className="card block p-4 transition-colors hover:border-muted">
                  <span className="font-medium">{p.title}</span>
                  <span className="mt-1 block text-sm text-muted">{p.description}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
