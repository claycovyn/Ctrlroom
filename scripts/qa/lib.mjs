// Shared helpers for the QA scripts: browsers, real touch drags (Chromium CDP), synthetic pointer drags (WebKit),
// and in-page probes for frame timing, long tasks and finger-vs-panel tracking.
import { chromium, webkit, devices } from "playwright";
import { startServer } from "./serve.mjs";

export const PORT = Number(process.env.QA_PORT ?? 3299);
export const BASE = `http://127.0.0.1:${PORT}`;

export async function server() {
  return startServer(PORT);
}

/** Chromium as an iPhone 13 (touch, 3x, mobile viewport), optionally CPU-throttled through CDP. */
export async function chromiumPhone({ throttle = 1, width = 390, height = 844, dark = false } = {}) {
  const browser = await chromium.launch({ channel: process.env.QA_CHROME_CHANNEL ?? "chrome" });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices["iPhone 13"].userAgent,
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return { browser, context, page, cdp };
}

export async function chromiumDesktop({ width = 1440, height = 900, dark = false, throttle = 1 } = {}) {
  const browser = await chromium.launch({ channel: process.env.QA_CHROME_CHANNEL ?? "chrome" });
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return { browser, context, page, cdp };
}

export async function webkitPhone({ device = "iPhone 13", dark = false } = {}) {
  const browser = await webkit.launch();
  const context = await browser.newContext({ ...devices[device], colorScheme: dark ? "dark" : "light" });
  const page = await context.newPage();
  return { browser, context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/**
 * A real touch drag through CDP (Chromium): touchstart, a move every `frame` ms along the path, touchend. The browser
 * generates pointer events, scrolls, honours touch-action, exactly as for a finger. `points` = [[x,y], ...].
 */
export async function touchPath(cdp, points, { frame = 16, hold = 0 } = {}) {
  const [x0, y0] = points[0];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
  if (hold) await sleep(hold);
  for (const [x, y] of points.slice(1)) {
    await sleep(frame);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
  }
  await sleep(frame);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Points from a to b over `ms` at `frame` ms per step, with an ease (linear | out). */
export function line([ax, ay], [bx, by], ms, { frame = 16, ease = "linear" } = {}) {
  const n = Math.max(1, Math.round(ms / frame));
  const out = [];
  for (let i = 0; i <= n; i++) {
    let t = i / n;
    if (ease === "out") t = 1 - (1 - t) * (1 - t);
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}

/**
 * Synthetic pointer + touch events for WebKit (Playwright has no touch drag there). Pointer events drive the app's
 * gestures; the TouchEvents let touchmove preventDefault paths run. Not a real finger: no native scrolling.
 */
export async function syntheticDrag(page, points, { frame = 16, target = null } = {}) {
  await page.evaluate(
    async ({ points, frame, target }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const [x0, y0] = points[0];
      const el = target ? document.querySelector(target) : document.elementFromPoint(x0, y0);
      const opts = (x, y) => ({ bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 });
      const touch = (type, x, y) => {
        try {
          const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
          el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] }));
        } catch {
          // no Touch constructor
        }
      };
      touch("touchstart", x0, y0);
      // A finger going down also enters what it lands on (React's onPointerEnter comes from pointerover).
      el.dispatchEvent(new PointerEvent("pointerover", opts(x0, y0)));
      el.dispatchEvent(new PointerEvent("pointerdown", opts(x0, y0)));
      for (const [x, y] of points.slice(1)) {
        await sleep(frame);
        touch("touchmove", x, y);
        (document.elementFromPoint(x, y) ?? el).dispatchEvent(new PointerEvent("pointermove", opts(x, y)));
        el.dispatchEvent(new PointerEvent("pointermove", opts(x, y)));
      }
      const [xe, ye] = points[points.length - 1];
      await sleep(frame);
      touch("touchend", xe, ye);
      el.dispatchEvent(new PointerEvent("pointerup", { ...opts(xe, ye), buttons: 0 }));
    },
    { points, frame, target },
  );
}

/**
 * Starts recording in the page: every animation frame's delta, long tasks (Chromium), and per frame the last
 * pointer x vs the chat panel's translateX. stopProbe() returns the samples.
 */
export async function startProbe(page, selector = ".cr-stage") {
  await page.evaluate((selector) => {
    const W = window;
    const st = { frames: [], longtasks: [], track: [], x: null, x0: null, running: true };
    W.__probe = st;
    const onMove = (e) => {
      if (st.x0 === null) st.x0 = e.clientX;
      st.x = e.clientX;
    };
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("pointerdown", (e) => ((st.x0 = e.clientX), (st.x = e.clientX), (st.downAt = e.timeStamp)), { capture: true, passive: true, once: true });
    const onUp = (e) => (st.upAt = e.timeStamp);
    window.addEventListener("pointerup", onUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", onUp, { capture: true, passive: true });
    st.off = () => window.removeEventListener("pointermove", onMove, { capture: true });
    try {
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => st.longtasks.push({ start: e.startTime, ms: e.duration })));
      po.observe({ type: "longtask", buffered: false });
      st.po = po;
    } catch {
      // no longtask in WebKit
    }
    let last = performance.now();
    st.t0 = last;
    const el = () => document.querySelector(selector);
    const tick = (t) => {
      if (!st.running) return;
      st.frames.push(t - last);
      last = t;
      const e = el();
      if (e) {
        const m = new DOMMatrixReadOnly(getComputedStyle(e).transform === "none" ? undefined : getComputedStyle(e).transform);
        st.track.push({ t, finger: st.x !== null && st.x0 !== null ? st.x - st.x0 : null, panel: m.m41 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
}

export async function stopProbe(page) {
  return page.evaluate(() => {
    const st = window.__probe;
    st.running = false;
    st.off?.();
    st.po?.disconnect();
    const frames = st.frames.slice(1);
    const end = performance.now();
    // Where each long task fell: while the finger was down, in the settle that follows (400 ms), or after.
    const phase = (t) => (st.downAt != null && t >= st.downAt - 5 && (st.upAt == null || t <= st.upAt) ? "drag" : st.upAt != null && t > st.upAt && t <= st.upAt + 400 ? "settle" : "after");
    const longtasks = st.longtasks.map((l) => ({ ...l, phase: phase(l.start) }));
    // Frame deltas while the finger is down / settling only.
    const inGesture = [];
    let t = st.t0;
    for (const f of st.frames) {
      t += f;
      if (st.downAt != null && t >= st.downAt && t <= (st.upAt ?? end) + 400) inGesture.push(f);
    }
    return { frames, inGesture, longtasks, track: st.track };
  });
}

export function summarizeFrames(frames) {
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    n: frames.length,
    p50: +p(0.5).toFixed(1),
    p95: +p(0.95).toFixed(1),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
    over32: frames.filter((f) => f > 32).length,
  };
}

/** Wait until the room's messages are painted (the harness room has a message list with rows). */
export async function roomPainted(page, name) {
  await page.waitForFunction((name) => {
    const h = document.querySelector(".cr-stage h1");
    return h && h.textContent.includes(name) && document.querySelectorAll(".cr-stage [id^='m-']").length > 0;
  }, name);
}
