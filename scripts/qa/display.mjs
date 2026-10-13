// What reaches the screen: Chrome's Display::FrameDisplayed events (compositor frames, which is what you see; rAF on
// the main thread can stall while a CSS transition still animates fine) during phone gestures, CPU throttled.
// For each: the longest gap between displayed frames while the finger is down, from release to the first frame of
// the settle, and during the settle. Usage: node scripts/qa/display.mjs [--throttle 4] [--json out.json]
import { writeFileSync } from "node:fs";
import { BASE, chromiumPhone, line, roomPainted, server, sleep, touchPath } from "./lib.mjs";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const throttle = Number(arg("--throttle", 4));
const out = arg("--json", null);
const srv = await server();
const { browser, page, cdp } = await chromiumPhone({ throttle });
const results = {};

async function traced(name, act) {
  const events = [];
  const onData = (e) => events.push(...e.value);
  cdp.on("Tracing.dataCollected", onData);
  const done = new Promise((ok) => cdp.once("Tracing.tracingComplete", ok));
  await cdp.send("Tracing.start", { categories: "devtools.timeline,viz,benchmark", transferMode: "ReportEvents" });
  await act();
  await sleep(900);
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  const ev = (type) => events.filter((e) => e.name === "EventDispatch" && e.args?.data?.type === type).map((e) => e.ts / 1000);
  const down = ev("pointerdown")[0] ?? ev("touchstart")[0];
  const up = ev("pointerup").pop() ?? ev("click").pop() ?? down;
  const shown = [...new Set(events.filter((e) => e.name === "Display::FrameDisplayed").map((e) => e.ts / 1000))].sort((a, b) => a - b);
  const gaps = (from, to) => {
    const f = shown.filter((t) => t >= from && t <= to);
    return f.slice(1).map((t, i) => t - f[i]);
  };
  const max = (a) => +Math.max(0, ...a).toFixed(0);
  const firstAfter = shown.find((t) => t > up);
  results[name] = {
    dragMaxGap: max(gaps(down, up)),
    releaseToFirstFrame: firstAfter ? +(firstAfter - up).toFixed(0) : null,
    settleMaxGap: max(gaps(up, up + 400)),
    settleFrames: shown.filter((t) => t > up && t <= up + 400).length,
  };
  console.log(name.padEnd(18), JSON.stringify(results[name]));
}

try {
  await page.goto(`${BASE}/c/night-shift/general`);
  await roomPainted(page, "general");
  await sleep(2500);
  await traced("drag open", () => touchPath(cdp, line([60, 400], [240, 410], 500)));
  await traced("drag close", () => touchPath(cdp, line([360, 400], [180, 405], 400)));
  await traced("flick open", () => touchPath(cdp, line([40, 500], [150, 505], 90)));
  await traced("tap strip", async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 370, y: 400, id: 1 }] });
    await sleep(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
  await touchPath(cdp, line([40, 500], [160, 505], 90));
  await sleep(900);
  const box = await page.locator(".cr-nav a", { hasText: "design" }).first().boundingBox();
  await traced("tap room", async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }] });
    await sleep(60);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
} finally {
  if (out) writeFileSync(out, JSON.stringify({ throttle, results }, null, 2));
  await browser.close();
  srv.close();
}
