import "server-only";
import { siteUrl } from "@/lib/env";
import { findPage, searchDocs } from "@/lib/docs";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

/** Brave bills past its $5 monthly credit (~1,000 searches), so it's capped below that unless the operator says otherwise. */
export const BRAVE_DEFAULT_MONTHLY_LIMIT = 900;
export const SEARCH_QUOTA_SERVICE = "web_search";
export const SEARCH_PAUSED_STEP = "Web search is paused until next month";
export const SEARCH_PAUSED_RESULT =
  "Web search is paused until next month: this server's monthly search budget is used up. Don't call web_search again. " +
  "Answer from the conversation and what you know, and say you couldn't search the web.";

/**
 * Searches allowed per UTC month for the whole server, or null for no limit.
 * SEARCH_MONTHLY_LIMIT wins when it's a whole number; otherwise Brave (paid) gets 900 and SearXNG (self-hosted) is unmetered.
 */
export function searchMonthlyLimit(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.SEARCH_MONTHLY_LIMIT ?? "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return env.SEARCH_PROVIDER === "brave" ? BRAVE_DEFAULT_MONTHLY_LIMIT : null;
}

export type TakeQuota = (service: string, limit: number) => Promise<boolean>;

/** Takes one search from this month's budget. Any error counts as "no": a paid search never runs unmetered. */
export const takeSearchQuota: TakeQuota = async (service, limit) => {
  const db = supabaseAdmin();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("take_quota", { p_service: service, p_limit: limit });
    return !error && data === true;
  } catch {
    return false;
  }
};

export type WebSearchOutcome = { paused: true } | { paused: false; results: SearchResult[] };

/** Runs one web search, after taking it from the monthly budget when one applies. Never throws for a spent budget. */
export async function webSearch(
  query: string,
  signal: AbortSignal,
  takeQuota: TakeQuota = takeSearchQuota,
  env: Record<string, string | undefined> = process.env,
): Promise<WebSearchOutcome> {
  const limit = searchMonthlyLimit(env);
  if (limit !== null) {
    let ok = false;
    try {
      ok = await takeQuota(SEARCH_QUOTA_SERVICE, limit);
    } catch {
      ok = false;
    }
    if (!ok) return { paused: true };
  }
  return { paused: false, results: await searchProvider(query, signal, env) };
}

async function searchProvider(query: string, signal: AbortSignal, env: Record<string, string | undefined>): Promise<SearchResult[]> {
  const provider = env.SEARCH_PROVIDER;
  if (provider === "searxng") {
    const u = new URL("/search", env.SEARXNG_URL);
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
    const res = await fetch(u, { signal, headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY ?? "" } });
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
  }
  throw new Error("web search isn't set up on this server");
}

export interface ToolRun {
  /** Shown in the room while it runs, e.g. "Searching the web: “postgres 17”". */
  step: string;
  /** setStep replaces the room's progress text, e.g. when web search turns out to be paused. */
  run: (setStep?: (step: string) => Promise<void>) => Promise<string>;
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
        run: async (setStep) => {
          const out = await webSearch(q, signal);
          if (out.paused) {
            await setStep?.(SEARCH_PAUSED_STEP).catch(() => undefined);
            return SEARCH_PAUSED_RESULT;
          }
          const results = out.results;
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
