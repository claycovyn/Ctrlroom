// JS CPU profile (self time by function) of switching rooms on a phone: node scripts/qa/profile.mjs [room]
import { BASE, chromiumPhone, line, roomPainted, server, sleep, touchPath } from "./lib.mjs";
const target = process.argv[2] ?? "design";
const srv = await server();
const { browser, page, cdp } = await chromiumPhone({ throttle: 4 });
await page.goto(`${BASE}/c/night-shift/general`);
await roomPainted(page, "general");
await sleep(2500);
await touchPath(cdp, line([40, 500], [160, 505], 90));
await sleep(800);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const box = await page.locator(".cr-nav a", { hasText: target }).first().boundingBox();
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }] });
await sleep(60);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(1500);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
srv.close();
const dt = {};
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
  dt[k] = (dt[k] ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000;
}
const total = Object.entries(dt).filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).reduce((a, [, v]) => a + v, 0);
console.log("total JS ms", total.toFixed(0));
for (const [k, v] of Object.entries(dt).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(1).padStart(7), k);
