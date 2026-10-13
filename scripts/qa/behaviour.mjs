// Phone navigation behaviour, asserted: WebKit as an iPhone (synthetic touch pointers; Playwright has no touch drag
// there) and Chrome as an iPhone (real CDP touch). Exits non-zero on any failure.
// Usage: node scripts/qa/behaviour.mjs [webkit|chromium|both]
import { BASE, chromiumPhone, line, roomPainted, server, sleep, syntheticDrag, touchPath, webkitPhone } from "./lib.mjs";

const which = process.argv[2] ?? "both";
const srv = await server();
let failures = 0;

async function suite(engine) {
  const isWebkit = engine === "webkit";
  const env = isWebkit ? await webkitPhone() : await chromiumPhone();
  const { browser, page } = env;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const drag = (points) => (isWebkit ? syntheticDrag(page, points) : touchPath(env.cdp, points));
  const tap = async (x, y) => {
    if (isWebkit) return page.touchscreen.tap(x, y);
    await env.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await sleep(50);
    await env.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const tapEl = async (locator) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error("not on screen");
    await tap(b.x + Math.min(b.width / 2, 40), b.y + b.height / 2);
  };
  const nav = () => page.evaluate(() => document.querySelector(".cr-stage-row")?.getAttribute("data-nav"));
  const x = () => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".cr-stage")).transform === "none" ? undefined : getComputedStyle(document.querySelector(".cr-stage")).transform).m41);
  const settle = () => sleep(650);
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${engine}: ${name}`);
    } catch (e) {
      failures += 1;
      console.log(`  FAIL ${engine}: ${name}: ${e.message.split("\n")[0]}`);
    }
  };
  const expectEq = (a, b, what) => {
    if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
  const open = async () => {
    await drag(line([40, 420], [260, 425], 300));
    await settle();
  };
  const close = async () => {
    if ((await nav()) === "open") await tap(370, 420);
    await settle();
  };

  try {
    await check("deep link into a room", async () => {
      await page.goto(`${BASE}/c/night-shift/design`);
      await roomPainted(page, "design");
      await sleep(800);
      expectEq(await nav(), "closed", "nav");
    });
    await check("swipe right opens the rooms, settles open", async () => {
      await open();
      expectEq(await nav(), "open", "nav");
      expectEq(Math.round(await x()), 390 - 52, "chat x");
      const visible = await page.evaluate(() => getComputedStyle(document.querySelector(".cr-nav")).contentVisibility);
      expectEq(visible === "hidden", false, "rooms hidden while open");
    });
    await check("the chat is inert once open, the rooms are not", async () => {
      expectEq(await page.evaluate(() => document.querySelector(".cr-stage > div").inert), true, "chat inert");
      expectEq(await page.evaluate(() => document.querySelector(".cr-nav").inert), false, "rooms inert");
    });
    await check("swipe left closes", async () => {
      await drag(line([360, 420], [100, 425], 300));
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
      expectEq(await page.evaluate(() => document.querySelector(".cr-stage > div").inert), false, "chat inert");
      expectEq(await page.evaluate(() => getComputedStyle(document.querySelector(".cr-nav")).contentVisibility), "hidden", "rooms hidden when covered");
    });
    await check("a tap on the strip closes", async () => {
      await open();
      await tap(370, 420);
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("a short slow drag settles back", async () => {
      await drag(line([40, 420], [110, 422], 600));
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
    });
    await check("a flick opens even when short", async () => {
      await drag(line([40, 420], [120, 422], 60));
      await settle();
      expectEq(await nav(), "open", "nav");
      await close();
    });
    await check("vertical and steep diagonal drags never open", async () => {
      await drag(line([200, 600], [215, 250], 250));
      await settle();
      await drag(line([100, 600], [180, 470], 250));
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("a drag starting on the message field stays with the field", async () => {
      const b = await page.locator("textarea").boundingBox();
      await drag(line([b.x + 20, b.y + b.height / 2], [b.x + 250, b.y + b.height / 2], 300));
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("a press-and-hold on a message doesn't move anything (and its toolbar is there)", async () => {
      const m = page.locator(".cr-stage [id^='m-']").nth(-3);
      const b = await m.boundingBox();
      if (isWebkit) {
        await syntheticDrag(page, [[b.x + 120, b.y + 20], [b.x + 121, b.y + 20], [b.x + 121, b.y + 21]], { frame: 300 });
      } else {
        await env.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + 120, y: b.y + 20, id: 1 }] });
        await sleep(700);
        await env.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
      expectEq(await m.locator("button[aria-label='React']").count(), 1, "toolbar built");
    });
    await check("sideways scroll in a code block stays in the code block", async () => {
      await page.goto(`${BASE}/c/night-shift/general`);
      await roomPainted(page, "general");
      await page.waitForFunction(() => window.__sim.topics().includes(`room:${window.__data.rooms[0].id}`));
      await page.evaluate(() => {
        const r = window.__data.rooms[0];
        window.__sim.emit(`room:${r.id}`, "message", { id: "f2000000-0000-4000-8000-000000000001", room_id: r.id, community_id: r.community_id, author_id: window.__data.profiles[3].id, parent_id: null, body: "```\n" + "const veryLongLine = ".repeat(12) + "1;\n```", reply_count: 0, last_reply_at: null, resolved_at: null, resolved_by: null, outcome: null, edited_at: null, deleted_at: null, created_at: new Date().toISOString(), attachments: [] });
      });
      await sleep(600);
      const pre = page.locator(".cr-stage pre").last();
      await pre.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      const b = await pre.boundingBox();
      const onPre = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("pre")), [b.x + 30, b.y + b.height / 2]);
      expectEq(onPre, true, "the drag starts on the code block");
      expectEq(await pre.evaluate((el) => el.scrollWidth > el.clientWidth), true, "the code block scrolls sideways");
      await drag(line([b.x + 30, b.y + b.height / 2], [b.x + 260, b.y + b.height / 2], 300));
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("a sideways swipe on a thread panel closes the panel, not the chat", async () => {
      const replies = page.locator(".cr-stage button", { hasText: /\d+ repl/ }).last();
      await replies.scrollIntoViewIfNeeded();
      await tapEl(replies);
      await page.waitForSelector(".cr-panel");
      await sleep(500);
      await drag(line([60, 420], [300, 425], 250));
      await settle();
      expectEq(await page.locator(".cr-panel").count(), 0, "panel open");
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
    });
    await check("swiping in the image viewer never moves the chat", async () => {
      const img = page.locator(".cr-stage button[aria-label$='Open']").last();
      await img.scrollIntoViewIfNeeded();
      await sleep(300);
      await tapEl(img);
      await page.waitForSelector("dialog[open]");
      await sleep(300);
      await drag(line([60, 420], [320, 425], 250));
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
      await page.keyboard.press("Escape");
      await sleep(300);
      expectEq(await page.locator("dialog[open]").count(), 0, "viewer closed");
    });
    await check("swiping on a bottom sheet (confirm) never moves the chat", async () => {
      await page.locator("textarea").fill("one of mine");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => [...document.querySelectorAll(".cr-stage [id^='m-']")].some((e) => e.textContent.includes("one of mine")));
      await sleep(900);
      await page.evaluate(() => document.activeElement?.blur());
      const mine = page.locator(".cr-stage [id^='m-']", { hasText: "one of mine" }).last();
      await mine.scrollIntoViewIfNeeded();
      await mine.hover().catch(() => {});
      await mine.dispatchEvent("pointerover");
      await mine.dispatchEvent("pointerenter");
      await sleep(200);
      await mine.locator("button[aria-label='Delete']").click({ force: true });
      await page.waitForSelector("dialog[open]");
      await sleep(450);
      const sheet = await page.locator("dialog[open]").boundingBox();
      const sy = sheet.y + sheet.height / 2;
      await drag(line([60, sy], [330, sy + 5], 250));
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(Math.round(await x()), 0, "chat x");
      await page.locator("dialog[open] button", { hasText: "Cancel" }).click();
      await sleep(300);
    });
    await check("the back gesture in a room shows the rooms; forward shows the chat again", async () => {
      await close();
      await page.evaluate(() => history.back());
      await settle();
      expectEq(await nav(), "open", "nav after back");
      expectEq(await page.evaluate(() => location.pathname), "/c/night-shift/general", "path");
    });
    await check("tapping a room in the rooms opens it and slides the chat back", async () => {
      if ((await nav()) !== "open") await open();
      expectEq(await nav(), "open", "nav before the tap");
      await tapEl(page.locator(".cr-nav a", { hasText: "launch-plan" }).first());
      await roomPainted(page, "launch-plan");
      await settle();
      expectEq(await nav(), "closed", "nav");
      expectEq(await page.evaluate(() => location.pathname), "/c/night-shift/launch-plan", "path");
    });
    await check("tapping the room you're in just closes the rooms", async () => {
      await open();
      await tapEl(page.locator(".cr-nav a[href='/c/night-shift/launch-plan']").last());
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("another community from the rail opens its rooms over its last room", async () => {
      await page.evaluate(() => localStorage.setItem("ctrlroom:last-room:design-club", "critique"));
      await open();
      await tapEl(page.locator(".cr-nav nav a[title='Design Club']"));
      await page.waitForFunction(() => location.pathname === "/c/design-club/critique");
      await roomPainted(page, "critique");
      await settle();
      expectEq(await nav(), "open", "nav");
      expectEq(await page.locator(".cr-nav h3, .cr-nav button", { hasText: /studio/i }).count() > 0, true, "Design Club rooms showing");
      await tap(370, 420);
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("a community with no last room shows its rooms to pick from", async () => {
      await open();
      await tapEl(page.locator(".cr-nav nav a[title='OSS Crew']"));
      await page.waitForFunction(() => location.pathname === "/c/oss-crew");
      await settle();
      expectEq(await nav(), "open", "nav");
      await tapEl(page.locator(".cr-nav a", { hasText: "triage" }).first());
      await roomPainted(page, "triage");
      await settle();
      expectEq(await nav(), "closed", "nav");
    });
    await check("direct messages from the rail, then a conversation", async () => {
      await open();
      await tapEl(page.locator(".cr-nav nav a[title='Direct messages']"));
      await page.waitForFunction(() => location.pathname === "/c/oss-crew/dm");
      await settle();
      expectEq(await nav(), "closed", "nav");
      await tapEl(page.locator(".cr-stage a", { hasText: "Launch crew" }).first());
      await page.waitForFunction(() => /\/dm\/9/.test(location.pathname));
      await page.waitForSelector(".cr-stage textarea");
      await sleep(400);
      await open();
      expectEq(await nav(), "open", "nav in a conversation");
      await close();
    });
    await check("rotating to landscape lays out side by side with nothing stuck", async () => {
      await open();
      await page.setViewportSize({ width: 844, height: 390 });
      await sleep(600);
      expectEq(Math.round(await x()), 0, "chat x in landscape");
      const navBox = await page.locator(".cr-nav aside").boundingBox();
      expectEq(navBox && navBox.width > 200 && navBox.x === 0, true, "sidebar beside the chat");
      expectEq(await page.evaluate(() => document.querySelector(".cr-stage > div").inert), false, "chat inert in landscape");
      expectEq(await page.evaluate(() => getComputedStyle(document.querySelector(".cr-nav")).contentVisibility), "visible", "sidebar rendered");
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(600);
      expectEq(Math.round(await x()) === 0 || Math.round(await x()) === 338, true, "chat x back in portrait");
    });
  } finally {
    if (errors.length) {
      failures += errors.length;
      console.log(`  FAIL ${engine}: page errors:`, errors);
    }
    await browser.close();
  }
}

try {
  if (which !== "chromium") await suite("webkit");
  if (which !== "webkit") await suite("chromium");
} finally {
  srv.close();
}
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
