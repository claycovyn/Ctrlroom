import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { loadDocs } from "@/lib/docs";
import { DocsNav } from "./DocsNav";

export const metadata: Metadata = {
  title: { default: "Docs", template: "%s · OpenCtrl docs" },
  description: "Help for every OpenCtrl app, including Ctrl Room.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const apps = loadDocs().map((a) => ({ slug: a.slug, name: a.name, pages: a.pages.map((p) => ({ slug: p.slug, title: p.title })) }));
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/">
            <Logo className="h-6 w-auto" />
          </Link>
          <Link href="/docs" className="font-mono text-xs uppercase tracking-[0.2em] text-muted hover:text-fg">
            Docs
          </Link>
          <Link href="/app" className="btn-outline ml-auto py-1.5 text-xs">
            Open Ctrl Room
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row">
        <DocsNav apps={apps} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
