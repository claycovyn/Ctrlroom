// Phone navigation gestures, measured: Chromium as an iPhone 13 with real CDP touch input and CPU throttling
// (default 4x). For each gesture: frame deltas (rAF) and long tasks from touchstart until the panel settles, and how
// closely the chat follows the finger while dragging (panel x vs finger x, per frame).
// Usage: node scripts/qa/swipe.mjs [--throttle 4] [--json out.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, chromiumPhone, line, roomPainted, server, sleep, startProbe, stopProbe, summarizeFrames, touchPath } from "./lib.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const throttle = Number(arg("--throttle", 4));
const out = arg("--json", null);
mkdirSync("scripts/qa/out", { recursive: true });

const srv = await server();
const { browser, page, cdp } = await chromiumPhone({ throttle });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = {};

const stageX = () => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".cr-stage")).transform === "none" ? undefined : getComputedStyle(document.querySelector(".cr-stage")).transform).m41);
const navState = () => page.evaluate(() => document.querySelector(".cr-stage-row")?.getAttribute("data-nav"));
async function settle() {
  // until the panel stops moving for 3 frames
  await page.evaluate(
    () =>
      new Promise((ok) => {
        let last = null;
        let same = 0;
        const t0 = performance.now();
        const f = () => {
          const m = getComputedStyle(document.querySelector(".cr-stage")).transform;
          same = m === last ? same + 1 : 0;
          last = m;
          if (same >= 3 || performance.now() - t0 > 3000) ok();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
  );
}

/** Long tasks by phase: the drag, the 400 ms settle after it, and later (deferred work once it's still). */
function lt(list) {
  const by = (ph) => list.filter((l) => l.phase === ph);
  const max = (l) => +Math.max(0, ...l.map((x) => x.ms)).toFixed(0);
  return { drag: max(by("drag")), settle: max(by("settle")), after: max(by("after")), n: list.length };
}

/** Tracking error while the finger is down: |panel - (start + finger)|, ignoring the slop before it engages. */
function tracking(track, start, span) {
  const errs = [];
  for (const s of track) {
    if (s.finger === null) continue;
    const want = Math.min(span, Math.max(0, start + s.finger));
    if (Math.abs(s.finger) < 14) continue;
    errs.push(Math.abs(s.panel - want));
  }
  errs.sort((a, b) => a - b);
  return { n: errs.length, p50: +(errs[Math.floor(errs.length / 2)] ?? 0).toFixed(1), max: +(errs[errs.length - 1] ?? 0).toFixed(1) };
}

async function gesture(name, points, { frame = 16, start = 0 } = {}) {
  await startProbe(page);
  const t0 = Date.now();
  await touchPath(cdp, points, { frame });
  const dragMs = Date.now() - t0;
  await settle();
  await sleep(600);
  const p = await stopProbe(page);
  // only the touch part for tracking: samples until release (approx by time share)
  const dragFrames = Math.max(1, Math.round((p.frames.length * dragMs) / (Date.now() - t0)));
  const span = 390 - 52;
  results[name] = {
    frames: summarizeFrames(p.inGesture),
    longtasks: lt(p.longtasks),
    tracking: tracking(p.track.slice(0, dragFrames), start, span),
    nav: await navState(),
  };
  console.log(name.padEnd(28), JSON.stringify(results[name]));
}

try {
  await page.goto(`${BASE}/c/night-shift/general`);
  await roomPainted(page, "general");
  await sleep(1500);

  // 1. slow drag right past a third → opens
  await gesture("slow drag open", line([60, 400], [300, 410], 600));
  // 2. swipe back left (slow) → closes
  await gesture("slow drag close", line([360, 400], [80, 405], 600), { start: 338 });
  // 3. flick right short → opens
  await gesture("flick open", line([40, 500], [150, 505], 90));
  // 4. tap the peek strip → closes
  await startProbe(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 370, y: 400, id: 1 }] });
  await sleep(40);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle();
  let p = await stopProbe(page);
  results["tap peek strip"] = { frames: summarizeFrames(p.inGesture), longtasks: lt(p.longtasks), nav: await navState() };
  console.log("tap peek strip".padEnd(28), JSON.stringify(results["tap peek strip"]));
  // 5. small drag below a third, slow → stays closed
  await gesture("short slow drag (stays)", line([60, 400], [140, 402], 700));
  // 6. vertical scroll never opens
  await gesture("vertical scroll", line([200, 600], [215, 200], 300));
  // 7. diagonal (mostly vertical)
  await gesture("diagonal 45°+ (stays)", line([100, 600], [180, 480], 250));

  // 8. open, then tap another room: time until its messages are painted and the chat is back over the rooms
  await gesture("flick open (again)", line([40, 500], [160, 505], 90));
  await sleep(300);
  const box = await page.locator(".cr-nav a", { hasText: "design" }).first().boundingBox();
  await startProbe(page);
  const t0 = await page.evaluate(() => performance.now());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2, id: 1 }] });
  await sleep(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.querySelector(".cr-stage h1")?.textContent.includes("design") && document.querySelectorAll(".cr-stage [id^='m-']").length > 0);
  const painted = await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(performance.now()))));
  await settle();
  const closed = await page.evaluate(() => performance.now());
  p = await stopProbe(page);
  results["tap room in nav"] = {
    toMessagesMs: Math.round(painted - t0),
    toSettledMs: Math.round(closed - t0),
    frames: summarizeFrames(p.frames),
    longtasks: lt(p.longtasks),
    nav: await navState(),
    x: await stageX(),
  };
  console.log("tap room in nav".padEnd(28), JSON.stringify(results["tap room in nav"]));

  // 9. drag while the message list is still scrolling (momentum) — fling up then drag right at once
  await touchPath(cdp, line([200, 300], [200, 700], 80));
  await sleep(30);
  await gesture("drag during scroll momentum", line([60, 500], [300, 505], 400));
  await gesture("close again", line([360, 400], [60, 405], 300), { start: 338 });

  await page.screenshot({ path: "scripts/qa/out/swipe-end.png" });
} finally {
  if (out) writeFileSync(out, JSON.stringify({ throttle, results, errors }, null, 2));
  if (errors.length) console.log("page errors:", errors);
  await browser.close();
  srv.close();
}
