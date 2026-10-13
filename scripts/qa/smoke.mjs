// Loads the harness on a WebKit iPhone and Chromium desktop and saves screenshots (scripts/qa/out/smoke-*.png).
import { mkdirSync } from "node:fs";
import { BASE, chromiumDesktop, server, webkitPhone } from "./lib.mjs";

mkdirSync("scripts/qa/out", { recursive: true });
const srv = await server();
const errors = [];
try {
  const p = await webkitPhone();
  p.page.on("pageerror", (e) => errors.push(`webkit: ${e.message}`));
  p.page.on("console", (m) => m.type() === "error" && errors.push(`webkit console: ${m.text()}`));
  await p.page.goto(`${BASE}/c/night-shift/general`);
  await p.page.waitForSelector(".cr-stage [id^='m-']");
  await p.page.waitForTimeout(500);
  await p.page.screenshot({ path: "scripts/qa/out/smoke-phone.png" });
  await p.page.click("button[aria-label='Open menu']");
  await p.page.waitForTimeout(600);
  await p.page.screenshot({ path: "scripts/qa/out/smoke-phone-nav.png" });
  await p.browser.close();

  const d = await chromiumDesktop();
  d.page.on("pageerror", (e) => errors.push(`chromium: ${e.message}`));
  d.page.on("console", (m) => m.type() === "error" && errors.push(`chromium console: ${m.text()}`));
  await d.page.goto(`${BASE}/c/night-shift/general`);
  await d.page.waitForSelector(".cr-stage [id^='m-']");
  await d.page.waitForTimeout(500);
  await d.page.screenshot({ path: "scripts/qa/out/smoke-desktop.png" });
  await d.browser.close();
} finally {
  srv.close();
}
console.log(errors.length ? errors.join("\n") : "no errors");
