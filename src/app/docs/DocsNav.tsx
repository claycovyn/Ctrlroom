"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DocsNav({ apps }: { apps: { slug: string; name: string; pages: { slug: string; title: string }[] }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="shrink-0 md:sticky md:top-20 md:h-[calc(100vh-6rem)] md:w-56 md:overflow-y-auto">
      {apps.map((a) => (
        <div key={a.slug} className="mb-6">
          <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{a.name}</h2>
          <ul>
            {a.pages.map((p) => {
              const href = `/docs/${a.slug}/${p.slug}`;
              return (
                <li key={p.slug}>
                  <Link
                    href={href}
                    className={`block rounded-md px-2 py-1.5 text-sm ${path === href ? "bg-raised font-medium" : "text-muted hover:bg-raised hover:text-fg"}`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
