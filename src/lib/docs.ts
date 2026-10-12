import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { cache } from "react";

// Docs live in content/docs/<app>/NN-slug.md with a small front matter block.
// Each app folder has an _app.json: { name, tagline, order }.
const ROOT = path.join(process.cwd(), "content", "docs");

export interface DocPage {
  app: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  url: string;
}

export interface DocApp {
  slug: string;
  name: string;
  tagline: string;
  order: number;
  pages: DocPage[];
}

export function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

export const loadDocs = cache((): DocApp[] => {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const info = JSON.parse(readFileSync(path.join(dir, "_app.json"), "utf8")) as { name: string; tagline: string; order?: number };
      const pages = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => {
          const { meta, body } = parseFrontMatter(readFileSync(path.join(dir, f), "utf8"));
          const slug = f.replace(/^\d+-/, "").replace(/\.md$/, "");
          return { app: d.name, slug, title: meta.title ?? slug, description: meta.description ?? "", body, url: `/docs/${d.name}/${slug}` };
        });
      return { slug: d.name, name: info.name, tagline: info.tagline, order: info.order ?? 99, pages };
    })
    .sort((a, b) => a.order - b.order);
});

export function findPage(app: string, slug: string): { app: DocApp; page: DocPage } | null {
  const a = loadDocs().find((x) => x.slug === app);
  const page = a?.pages.find((p) => p.slug === slug);
  return a && page ? { app: a, page } : null;
}

export interface DocHit {
  app: string;
  title: string;
  heading: string;
  url: string;
  text: string;
  score: number;
}

const STOP = new Set("a an and are as at be but by can do does for from how i in is it of on or so the to what when where which who why will with you your my me".split(" "));
export const terms = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9@#]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => t.replace(/(ing|ed|es|s)$/, "") || t);

/** Keyword search over doc sections (## headings). Small corpus, so no index needed. */
export function searchDocs(query: string, limit = 5, apps: DocApp[] = loadDocs()): DocHit[] {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const hits: DocHit[] = [];
  for (const app of apps) {
    for (const page of app.pages) {
      const sections = page.body.split(/\n(?=## )/);
      for (const section of sections) {
        const heading = section.match(/^#{1,2} (.+)/)?.[1]?.trim() ?? page.title;
        const head = terms(`${page.title} ${heading} ${app.name}`);
        const words = terms(section);
        let score = 0;
        for (const t of q) {
          const n = words.filter((w) => w === t).length;
          if (n) score += 1 + Math.log(n);
          if (head.includes(t)) score += 2;
        }
        if (score > 0) {
          const anchor = heading === page.title ? "" : `#${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
          hits.push({ app: app.name, title: page.title, heading, url: `${page.url}${anchor}`, text: section.trim().slice(0, 1800), score });
        }
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
