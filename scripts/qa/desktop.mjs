// Desktop pass: Chrome at 1440x900 and 1280x720, light and dark. Room, hover toolbar, thread, people, search, image
// viewer, confirm dialog, DMs, settings; layout shift while switching rooms; page errors. Screenshots go to
// scripts/qa/out/desktop/. Usage: node scripts/qa/desktop.mjs
import { mkdirSync } from "node:fs";
import { BASE, chromiumDesktop, roomPainted, server, sleep } from "./lib.mjs";

const OUT = "scripts/qa/out/desktop";
mkdirSync(OUT, { recursive: true });
const srv = await server();
const problems = [];
try {
  for (const [w, h] of [[1440, 900], [1280, 720]]) {
    for (const dark of [false, true]) {
      const tag = `${w}-${dark ? "dark" : "light"}`;
      const { browser, page } = await chromiumDesktop({ width: w, height: h, dark });
      page.on("pageerror", (e) => problems.push(`${tag}: ${e.message}`));
      const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
      await page.goto(`${BASE}/c/night-shift/general`);
      await roomPainted(page, "general");
      await sleep(800);
      await page.evaluate(() => {
        window.__cls = 0;
        new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: false });
      });
      await shot("room");
      const msg = page.locator(".cr-stage [id^='m-']").nth(-2);
      await msg.hover();
      await sleep(200);
      if ((await msg.locator("button[aria-label='React']").count()) !== 1) problems.push(`${tag}: hover toolbar missing`);
      await shot("hover");
      for (const room of ["design", "launch-plan", "general"]) {
        await page.locator(".cr-nav a", { hasText: room }).first().click();
        await roomPainted(page, room);
        await sleep(500);
      }
      const cls = await page.evaluate(() => window.__cls);
      if (cls > 0.05) problems.push(`${tag}: layout shift while switching rooms ${cls.toFixed(3)}`);
      const replies = page.locator(".cr-stage button", { hasText: /\d+ repl/ }).last();
      await replies.scrollIntoViewIfNeeded();
      await replies.click();
      await page.waitForSelector(".cr-panel [id^='m-']");
      await sleep(300);
      await shot("thread");
      await page.locator("button[aria-label='People']").click();
      await page.waitForSelector(".cr-panel li");
      await sleep(300);
      await shot("people");
      await page.locator("button[aria-label='Search']").click();
      await page.locator(".cr-panel input").fill("staging");
      await page.keyboard.press("Enter");
      await sleep(600);
      await shot("search");
      await page.locator(".cr-panel button[aria-label='Close panel']").click();
      const img = page.locator(".cr-stage button[aria-label$='Open']").last();
      await img.scrollIntoViewIfNeeded();
      await sleep(300);
      await img.click();
      await page.waitForSelector("dialog[open] img");
      await sleep(400);
      await shot("viewer");
      await page.keyboard.press("ArrowRight");
      await sleep(200);
      await page.keyboard.press("Escape");
      await sleep(300);
      await page.locator("textarea").fill("one of mine");
      await page.keyboard.press("Enter");
      await sleep(900);
      const mine = page.locator(".cr-stage [id^='m-']", { hasText: "one of mine" }).last();
      await mine.hover();
      await mine.locator("button[aria-label='Delete']").click();
      await page.waitForSelector("dialog[open]");
      await sleep(300);
      await shot("confirm");
      await page.keyboard.press("Escape");
      await sleep(300);
      if ((await page.locator("dialog[open]").count()) !== 0) problems.push(`${tag}: Esc didn't close the confirm`);
      await page.locator(".cr-nav a[title='Direct messages']").click();
      await page.waitForFunction(() => location.pathname.endsWith("/dm"));
      await sleep(600);
      await shot("dm-inbox");
      await page.locator(".cr-stage a", { hasText: "Launch crew" }).first().click();
      await page.waitForSelector(".cr-stage textarea");
      await sleep(600);
      await shot("dm-conversation");
      await page.locator(".cr-nav a[title='Community info and settings']").click();
      await page.waitForFunction(() => location.pathname.endsWith("/settings"));
      await sleep(800);
      await shot("settings");
      await browser.close();
    }
  }
} finally {
  srv.close();
}
console.log(problems.length ? problems.join("\n") : "no problems");
