import "server-only";
import { siteUrl } from "@/lib/env";
import { findPage, searchDocs } from "@/lib/docs";
import type { ToolSpec } from "./llm";
import { safeFetchText } from "./safeFetch";
import { clip, htmlToText } from "./text";

export type Bot = "ctrl" | "openctrl";

const spec = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const SEARCH_DOCS = spec(
  "search_docs",
  "Search the OpenCtrl docs (Ctrl Room and other OpenCtrl apps). Returns the best matching sections with their URLs.",
  { query: { type: "string", description: "What to look for, in plain words." } },
  ["query"],
);
const READ_DOC = spec(
  "read_doc",
  "Read a whole docs page. Pass the path from a search_docs result, like /docs/ctrl-room/roles-and-moderation.",
  { path: { type: "string" } },
  ["path"],
);
const WEB_SEARCH = spec(
  "web_search",
  "Search the web. Use for anything current, factual, or that you're not sure about. Returns titles, URLs and snippets.",
  { query: { type: "string" } },
  ["query"],
);
const READ_URL = spec(
  "read_url",
  "Read the text of a public web page. Use on the most relevant search results before answering.",
  { url: { type: "string" } },
  ["url"],
);

export function searchConfigured(): boolean {
  const p = process.env.SEARCH_PROVIDER;
  return (p === "searxng" && !!process.env.SEARXNG_URL) || (p === "brave" && !!process.env.BRAVE_API_KEY);
}

export function toolsFor(bot: Bot): ToolSpec[] {
  if (bot === "openctrl") return [SEARCH_DOCS, READ_DOC];
  return searchConfigured() ? [WEB_SEARCH, READ_URL, SEARCH_DOCS] : [READ_URL, SEARCH_DOCS];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const provider = process.env.SEARCH_PROVIDER;
  if (provider === "searxng") {
    const u = new URL("/search", process.env.SEARXNG_URL);
    u.searchParams.set("q", query);
    u.searchParams.set("format", "json");
    const res = await fetch(u, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? []).slice(0, 6).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
  }
  if (provider === "brave") {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", query);
    u.searchParams.set("count", "6");
    const res = await fetch(u, { signal, headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! } });
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
  }
  throw new Error("web search isn't set up on this server");
}

export interface ToolRun {
  /** Shown in the room while it runs, e.g. "Searching the web: “postgres 17”". */
  step: string;
  run: () => Promise<string>;
}

/** Turns a model tool call into a step label and a function that returns the tool result text. */
export function toolRun(name: string, rawArgs: string, signal: AbortSignal): ToolRun {
  let args: Record<string, string> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { step: "Thinking…", run: async () => "Error: the tool arguments weren't valid JSON." };
  }
  const q = String(args.query ?? "").slice(0, 200);
  switch (name) {
    case "web_search":
      return {
        step: `Searching the web: “${clip(q, 80)}”`,
        run: async () => {
          const results = await webSearch(q, signal);
          if (!results.length) return "No results.";
          return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${clip(r.snippet, 300)}`).join("\n\n");
        },
      };
    case "read_url": {
      const url = String(args.url ?? "");
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {}
      return {
        step: `Reading ${clip(host, 60)}`,
        run: async () => {
          const page = await safeFetchText(url);
          const { title, text } = /html/.test(page.contentType) ? htmlToText(page.body) : { title: "", text: page.body };
          return `URL: ${page.url}\nTitle: ${title}\n\n${clip(text, 12_000)}`;
        },
      };
    }
    case "search_docs":
      return {
        step: `Checking the docs: “${clip(q, 80)}”`,
        run: async () => {
          const hits = searchDocs(q, 4);
          if (!hits.length) return "No matching docs.";
          return hits.map((h) => `## ${h.app} › ${h.title} › ${h.heading}\nURL: ${siteUrl()}${h.url}\n\n${h.text}`).join("\n\n---\n\n");
        },
      };
    case "read_doc": {
      const path = String(args.path ?? "").replace(/^https?:\/\/[^/]+/, "").split("#")[0];
      return {
        step: "Reading the docs",
        run: async () => {
          const m = path.match(/^\/docs\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
          const found = m && findPage(m[1], m[2]);
          if (!found) return "No such docs page. Use search_docs to find the right path.";
          return `URL: ${siteUrl()}${found.page.url}\n\n${clip(found.page.body, 12_000)}`;
        },
      };
    }
    default:
      return { step: "Thinking…", run: async () => `Error: there's no tool called ${name}.` };
  }
}
