// Films the phone navigation with Chrome's screencast (the frames the compositor actually produced, not main-thread
// rAF ticks), CPU throttled: a slow drag open, a tap on the strip, a room tap. Saves every frame to
// scripts/qa/out/frames/<gesture>-<n>.jpg and prints the gaps between frames while it moves.
// Usage: node scripts/qa/frames.mjs [--throttle 4]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { BASE, chromiumPhone, line, roomPainted, server, sleep, touchPath } from "./lib.mjs";

const throttle = Number(process.argv[process.argv.indexOf("--throttle") + 1] || 4);
const OUT = "scripts/qa/out/frames";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const srv = await server();
const { browser, page, cdp } = await chromiumPhone({ throttle });
await page.goto(`${BASE}/c/night-shift/general`);
await roomPainted(page, "general");
await sleep(2500);

async function film(name, act, ms = 1200) {
  const frames = [];
  const on = async (f) => {
    frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", on);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 50, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  await sleep(150);
  await act();
  await sleep(ms);
  await cdp.send("Page.stopScreencast");
  cdp.off("Page.screencastFrame", on);
  frames.forEach((f, i) => writeFileSync(`${OUT}/${name}-${String(i).padStart(3, "0")}.jpg`, Buffer.from(f.data, "base64")));
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  const big = gaps.map((g, i) => [i + 1, Math.round(g)]).filter(([, g]) => g > 34).map(([i, g]) => `#${i}:${g}`);
  console.log(name.padEnd(16), `${frames.length} frames, gaps > 34 ms: ${big.length ? big.join(", ") : "none"}`);
  return frames.length;
}

try {
  await film("drag-open", () => touchPath(cdp, line([60, 400], [300, 410], 500)));
  await film("tap-strip", async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 370, y: 400, id: 1 }] });
    await sleep(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
  await touchPath(cdp, line([40, 500], [160, 505], 90));
  await sleep(900);
  const box = await page.locator(".cr-nav a", { hasText: "design" }).first().boundingBox();
  await film("tap-room", async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }] });
    await sleep(60);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }, 1500);
} finally {
  await browser.close();
  srv.close();
}
