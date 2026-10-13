// Records a Chrome trace of one phone gesture (CPU throttled) and prints what the long main-thread tasks spent
// their time on (style, layout, paint, script by function). Usage: node scripts/qa/trace.mjs [open|close|room]
import { BASE, chromiumPhone, line, roomPainted, server, sleep, touchPath } from "./lib.mjs";

const what = process.argv[2] ?? "open";
const srv = await server();
const { browser, page, cdp } = await chromiumPhone({ throttle: Number(process.env.QA_THROTTLE ?? 4) });
await page.goto(`${BASE}/c/night-shift/general`);
await roomPainted(page, "general");
await sleep(1500);
if (what !== "open") {
  await touchPath(cdp, line([40, 500], [160, 505], 90));
  await sleep(800);
}
const events = [];
cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
const done = new Promise((ok) => cdp.once("Tracing.tracingComplete", ok));
await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing", transferMode: "ReportEvents" });
if (what === "open") await touchPath(cdp, line([60, 400], [300, 410], 600));
else if (what === "close") await touchPath(cdp, line([360, 400], [80, 405], 600));
else {
  const box = await page.locator(".cr-nav a", { hasText: "design" }).first().boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }] });
  await sleep(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await sleep(1500);
await cdp.send("Tracing.end");
await done;
await browser.close();
srv.close();

const names = Object.fromEntries(events.filter((e) => e.name === "thread_name").map((e) => [e.tid, e.args.name]));
const main = events.filter((e) => e.name === "RunTask" && e.dur > Number(process.env.QA_MIN_MS ?? 30) * 1000 && names[e.tid] === "CrRendererMain");
const tid = main.length ? main[0].tid : null;
for (const t of main) {
  const inside = events.filter((e) => e.tid === t.tid && e.ts >= t.ts && e.ts + (e.dur ?? 0) <= t.ts + t.dur && e.dur && e !== t);
  const agg = {};
  for (const e of inside) {
    let k = e.name;
    if (k === "FunctionCall") k += `:${e.args?.data?.functionName || e.args?.data?.url?.split("/").pop() || "?"}`;
    if (k === "EventDispatch") k += `:${e.args?.data?.type}`;
    if (k === "TimerFire" || k === "FireAnimationFrame") k += "";
    agg[k] = (agg[k] ?? 0) + e.dur / 1000;
  }
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(1)}`);
  console.log(`task ${(t.dur / 1000).toFixed(0)} ms @${((t.ts - main[0].ts) / 1000).toFixed(0)}:`, top.join(" | "));
}
console.log("tid", tid, "long tasks", main.length);
