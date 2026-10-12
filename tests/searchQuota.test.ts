import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({ rpc }) }));

const { searchMonthlyLimit, webSearch, takeSearchQuota, toolRun, SEARCH_PAUSED_STEP, SEARCH_PAUSED_RESULT } = await import("@/lib/agent/tools");

const brave = { SEARCH_PROVIDER: "brave", BRAVE_API_KEY: "k" };
const searxng = { SEARCH_PROVIDER: "searxng", SEARXNG_URL: "http://searx.local" };
const braveBody = JSON.stringify({ web: { results: [{ title: "T", url: "https://x.dev", description: "<b>hi</b>" }] } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rpc.mockReset();
});

describe("searchMonthlyLimit", () => {
  it("defaults Brave to 900", () => expect(searchMonthlyLimit(brave)).toBe(900));
  it("uses an explicit value", () => {
    expect(searchMonthlyLimit({ ...brave, SEARCH_MONTHLY_LIMIT: "250" })).toBe(250);
    expect(searchMonthlyLimit({ ...brave, SEARCH_MONTHLY_LIMIT: " 0 " })).toBe(0);
  });
  it("leaves SearXNG unmetered unless set", () => {
    expect(searchMonthlyLimit(searxng)).toBeNull();
    expect(searchMonthlyLimit({ ...searxng, SEARCH_MONTHLY_LIMIT: "" })).toBeNull();
    expect(searchMonthlyLimit({ ...searxng, SEARCH_MONTHLY_LIMIT: "5000" })).toBe(5000);
  });
  it("ignores a value that isn't a whole number", () => {
    expect(searchMonthlyLimit({ ...brave, SEARCH_MONTHLY_LIMIT: "lots" })).toBe(900);
    expect(searchMonthlyLimit({ ...brave, SEARCH_MONTHLY_LIMIT: "-1" })).toBe(900);
    expect(searchMonthlyLimit({ ...searxng, SEARCH_MONTHLY_LIMIT: "1.5" })).toBeNull();
  });
});

describe("webSearch budget", () => {
  const signal = new AbortController().signal;

  it("takes a slot, then calls Brave", async () => {
    const fetchMock = vi.fn(async () => new Response(braveBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const take = vi.fn(async () => true);
    const out = await webSearch("q", signal, take, brave);
    expect(take).toHaveBeenCalledWith("web_search", 900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ paused: false, results: [{ title: "T", url: "https://x.dev", snippet: "hi" }] });
  });

  it("skips Brave when the budget is used up", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await webSearch("q", signal, async () => false, brave);
    expect(out).toEqual({ paused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Brave when the quota call fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await webSearch("q", signal, async () => Promise.reject(new Error("db down")), brave);
    expect(out).toEqual({ paused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limit 0 never searches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await webSearch("q", signal, takeSearchQuota, { ...brave, SEARCH_MONTHLY_LIMIT: "0" })).toEqual({ paused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't meter SearXNG by default", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const take = vi.fn(async () => false);
    expect(await webSearch("q", signal, take, searxng)).toEqual({ paused: false, results: [] });
    expect(take).not.toHaveBeenCalled();
  });

  it("takeSearchQuota treats an RPC error as no", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function take_quota does not exist" } });
    expect(await takeSearchQuota("web_search", 900)).toBe(false);
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await takeSearchQuota("web_search", 900)).toBe(false);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await takeSearchQuota("web_search", 900)).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("take_quota", { p_service: "web_search", p_limit: 900 });
  });
});

describe("web_search tool when paused", () => {
  it("tells the room and the model, without throwing or fetching", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "k");
    vi.stubEnv("SEARCH_MONTHLY_LIMIT", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    rpc.mockResolvedValue({ data: false, error: null });
    const steps: string[] = [];
    const t = toolRun("web_search", JSON.stringify({ query: "postgres 17" }), new AbortController().signal);
    const result = await t.run(async (s) => void steps.push(s));
    expect(result).toBe(SEARCH_PAUSED_RESULT);
    expect(steps).toEqual([SEARCH_PAUSED_STEP]);
    expect(SEARCH_PAUSED_STEP).toBe("Web search is paused until next month");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
