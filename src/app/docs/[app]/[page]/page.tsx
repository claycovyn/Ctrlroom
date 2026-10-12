import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { findPage, loadDocs } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";

export function generateStaticParams() {
  return loadDocs().flatMap((a) => a.pages.map((p) => ({ app: a.slug, page: p.slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ app: string; page: string }> }): Promise<Metadata> {
  const { app, page } = await params;
  const found = findPage(app, page);
  return found ? { title: `${found.page.title} · ${found.app.name}`, description: found.page.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ app: string; page: string }> }) {
  const { app, page } = await params;
  const found = findPage(app, page);
  if (!found) notFound();
  const pages = found.app.pages;
  const i = pages.findIndex((p) => p.slug === page);
  const prev = pages[i - 1];
  const next = pages[i + 1];

  return (
    <article>
      <p className="mb-2 text-xs text-muted">{found.app.name}</p>
      <div className="docs" dangerouslySetInnerHTML={{ __html: renderMarkdown(found.page.body) }} />
      <nav className="mt-12 flex justify-between gap-4 border-t border-line pt-6 text-sm">
        {prev ? (
          <Link href={prev.url} className="text-muted hover:text-fg">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={next.url} className="text-right text-muted hover:text-fg">
            {next.title} →
          </Link>
        )}
      </nav>
    </article>
  );
}
