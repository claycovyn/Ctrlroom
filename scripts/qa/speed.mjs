// Speed on a phone (Chrome as an iPhone 13, CPU 4x by default), against the harness:
// cold and warm start, room switch, send, opening panels and sheets, typing latency, scrolling a 300-message room,
// and memory over a busy session. Usage: node scripts/qa/speed.mjs [--throttle 4] [--minutes 2] [--json out.json]
import { writeFileSync } from "node:fs";
import { BASE, chromiumPhone, line, roomPainted, server, sleep, summarizeFrames, touchPath } from "./lib.mjs";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const throttle = Number(arg("--throttle", 4));
const minutes = Number(arg("--minutes", 2));
const out = arg("--json", null);
const srv = await server();
const r = {};
const log = (k, v) => {
  r[k] = v;
  console.log(k.padEnd(34), typeof v === "object" ? JSON.stringify(v) : v);
};

const { browser, context, page, cdp } = await chromiumPhone({ throttle });
const tap = async (x, y) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const tapEl = async (loc) => {
  const b = await loc.boundingBox();
  await tap(b.x + Math.min(40, b.width / 2), b.y + b.height / 2);
};
const now = () => page.evaluate(() => performance.now());
const nextPaint = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => setTimeout(() => ok(performance.now()), 0))));

try {
  // ── start
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(`${BASE}/c/night-shift/general`);
  await roomPainted(page, "general");
  log("cold start: first room painted (ms)", Math.round(await page.evaluate(() => performance.now())));
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.goto(`${BASE}/c/night-shift/general`);
  await page.reload();
  await roomPainted(page, "general");
  log("warm start: first room painted (ms)", Math.round(await page.evaluate(() => performance.now())));
  await sleep(2500);

  // ── room switch from the rooms (phone)
  const switches = [];
  for (const room of ["design", "engineering", "general"]) {
    await touchPath(cdp, line([40, 500], [160, 505], 90));
    await sleep(800);
    const t0 = await now();
    await tapEl(page.locator(".cr-nav a", { hasText: room }).first());
    await page.waitForFunction((room) => document.querySelector(".cr-stage h1")?.textContent.includes(room) && document.querySelectorAll(".cr-stage [id^='m-']").length > 0, room);
    switches.push(Math.round((await nextPaint()) - t0));
    await sleep(900);
  }
  log("room switch: tap -> messages (ms)", switches);

  // ── send
  const ta = page.locator("textarea");
  await ta.click();
  await page.keyboard.type("Testing the send path");
  const sendBox = await page.locator("button[aria-label='Send']").boundingBox();
  const t1 = await now();
  await tap(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
  await page.waitForFunction(() => [...document.querySelectorAll(".cr-stage [id^='m-']")].some((e) => e.textContent.includes("Testing the send path")));
  log("send: tap -> message visible (ms)", Math.round((await nextPaint()) - t1));

  // ── typing latency: from the key event to the frame after React has handled the input
  await page.evaluate(() => {
    window.__ev = [];
    document.addEventListener("keydown", (e) => {
      const t = e.timeStamp;
      requestAnimationFrame(() => setTimeout(() => window.__ev.push(performance.now() - t), 0));
    }, true);
  });
  await ta.click();
  await page.keyboard.type("the quick brown fox jumps over the lazy dog", { delay: 80 });
  await sleep(500);
  const ev = (await page.evaluate(() => window.__ev)).sort((a, b) => a - b);
  log("typing: keystroke -> next frame (ms)", { n: ev.length, p50: Math.round(ev[Math.floor(ev.length / 2)] ?? 0), p95: Math.round(ev[Math.floor(ev.length * 0.95)] ?? 0), max: Math.round(ev[ev.length - 1] ?? 0) });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => document.activeElement?.blur());

  // ── panels and sheets
  const timed = async (label, act, sel) => {
    const t = await now();
    await act();
    await page.waitForSelector(sel);
    const ms = Math.round((await nextPaint()) - t);
    await sleep(500);
    return ms;
  };
  r.panels = {};
  r.panels.members = await timed("members", () => tapEl(page.locator("button[aria-label='People']")), ".cr-panel li");
  await tapEl(page.locator(".cr-panel button[aria-label='Close panel']"));
  await sleep(500);
  r.panels.search = await timed("search", () => tapEl(page.locator("button[aria-label='Search']")), ".cr-panel input");
  await tapEl(page.locator(".cr-panel button[aria-label='Close panel']"));
  await sleep(500);
  const replies = page.locator(".cr-stage button", { hasText: /\d+ repl/ }).last();
  await replies.scrollIntoViewIfNeeded();
  r.panels.thread = await timed("thread", () => tapEl(replies), ".cr-panel [id^='m-']");
  await tapEl(page.locator(".cr-panel button[aria-label='Close panel']"));
  await sleep(500);
  const img = page.locator(".cr-stage button[aria-label$='Open']").last();
  await img.scrollIntoViewIfNeeded();
  await sleep(300);
  r.panels.imageViewer = await timed("viewer", () => tapEl(img), "dialog[open] img");
  await page.keyboard.press("Escape");
  await sleep(400);
  log("open: tap -> painted (ms)", r.panels);

  // ── scrolling a 300-message room
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => (document.querySelector(".cr-stage .overflow-y-auto").scrollTop = 0));
    await sleep(700);
  }
  const count = await page.locator(".cr-stage [id^='m-']").count();
  await page.evaluate(() => {
    const el = document.querySelector(".cr-stage .overflow-y-auto");
    el.scrollTop = el.scrollHeight;
  });
  await sleep(800);
  await page.evaluate(() => {
    window.__f = [];
    window.__lt = [];
    let last = performance.now();
    const tick = (t) => {
      window.__f.push(t - last);
      last = t;
      if (window.__f.length < 2000) window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask" });
  });
  for (let i = 0; i < 4; i++) {
    await touchPath(cdp, line([200, 250], [205, 750], 120)); // flick down = scroll up through history
    await sleep(500);
  }
  for (let i = 0; i < 4; i++) {
    await touchPath(cdp, line([200, 750], [205, 250], 120));
    await sleep(500);
  }
  const sc = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return { f: window.__f.slice(1), lt: window.__lt };
  });
  log("scroll 300-message room", { messages: count, frames: summarizeFrames(sc.f), longtasks: sc.lt.length, maxLongtask: Math.round(Math.max(0, ...sc.lt)) });

  // ── memory over a busy session
  await page.goto(`${BASE}/c/night-shift/general`);
  await roomPainted(page, "general");
  await sleep(1500);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap0 = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  const dom0 = await page.evaluate(() => document.getElementsByTagName("*").length);
  const end = Date.now() + minutes * 60_000;
  let n = 0;
  while (Date.now() < end) {
    n += 1;
    await page.evaluate((n) => {
      const D = window.__data;
      const r = D.rooms[n % 3 === 0 ? 0 : 3];
      window.__sim.emit(`room:${r.id}`, "message", { id: `f3000000-0000-4000-8000-${String(n).padStart(12, "0")}`, room_id: r.id, community_id: r.community_id, author_id: D.profiles[1 + (n % 15)].id, parent_id: null, body: `Live message ${n}`, reply_count: 0, last_reply_at: null, resolved_at: null, resolved_by: null, outcome: null, edited_at: null, deleted_at: null, created_at: new Date().toISOString(), attachments: [] });
      window.__sim.emit(`room:${r.id}`, "typing", { user_id: D.profiles[2 + (n % 10)].id, name: D.profiles[2 + (n % 10)].display_name });
      window.__sim.emit(`community:${D.communities[0].id}`, "activity", { room_id: D.rooms[n % 9].id, author_id: D.profiles[3].id, thread: false });
      const p = D.peers();
      const k = Object.keys(p)[n % Object.keys(p).length];
      p[k][0].status = n % 2 ? "away" : "online";
      window.__sim.setPeers(p);
    }, n);
    if (n % 10 === 0) {
      await touchPath(cdp, line([40, 500], [160, 505], 90));
      await sleep(700);
      await tapEl(page.locator(".cr-nav a", { hasText: n % 20 === 0 ? "general" : "design" }).first());
    }
    await sleep(1000);
  }
  await sleep(1000);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap1 = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  const dom1 = await page.evaluate(() => document.getElementsByTagName("*").length);
  log(`memory over ${minutes} min busy session`, { events: n, heapMB: [+(heap0 / 1e6).toFixed(1), +(heap1 / 1e6).toFixed(1)], domNodes: [dom0, dom1], channels: await page.evaluate(() => window.__sim.topics().length) });
} finally {
  if (out) writeFileSync(out, JSON.stringify({ throttle, ...r }, null, 2));
  await browser.close();
  srv.close();
}
