// Two people chatting live: sign up, create a community, invite, realtime messages,
// mentions, reactions, threads with outcomes, the board, search and announcement rooms.
//
// Needs: `npx supabase start`, `.env.local` pointing at it, `npm run build`.
// Usage: node scripts/e2e.mjs [baseUrl]   (starts `next start` on :3100 when no baseUrl)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { startMockAi } from "./mock-ai.mjs";

const SHOTS = process.env.E2E_SHOTS ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });

let server;
let mock;
let base = process.argv[2];
if (!base) {
  base = "http://localhost:3100";
  // Point the AI helpers at a local mock model + search engine (scripts/mock-ai.mjs).
  mock = await startMockAi(3199);
  const env = {
    ...process.env,
    AI_BASE_URL: "http://127.0.0.1:3199/v1",
    AI_MODEL: "mock",
    SEARCH_PROVIDER: "searxng",
    SEARXNG_URL: "http://127.0.0.1:3199",
    AGENT_UNSAFE_ALLOW_PRIVATE_URLS: "1",
  };
  server = spawn("node_modules/.bin/next", ["start", "-p", "3100"], { stdio: ["ignore", "pipe", "inherit"], env, detached: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("next start timed out")), 60_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("Ready")) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const run = Date.now().toString(36);
const slug = `crew-${run}`;
let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}\n     ${e.message.split("\n")[0]}`);
    await Promise.all(pages.map((p, i) => p.screenshot({ path: path.join(SHOTS, `fail-${i}.png`) }).catch(() => {})));
    throw e;
  }
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const pages = [];
const newPerson = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: process.env.E2E_SCHEME === "dark" ? "dark" : "light" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  pages.push(page);
  return page;
};

const signUp = async (page, who, url) => {
  await page.goto(url);
  if (!page.url().includes("mode=signup")) await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
};

const send = async (page, text) => {
  const box = page.getByPlaceholder(/^Message #/);
  await box.fill(text);
  await box.press("Enter");
};

const alice = { name: "Alice Ray", username: `alice${run}`, email: `alice-${run}@example.com` };
const bob = { name: "Bob Lee", username: `bob${run}`, email: `bob-${run}@example.com` };
let exitCode = 0;

try {
  const a = await newPerson();
  const b = await newPerson();
  let invite;

  await step("landing page shows the brand", async () => {
    await a.goto(base);
    await a.getByRole("heading", { name: "Where the collective talks." }).waitFor();
    await a.locator(`img[alt="Ctrl Room by OpenCtrl"]:visible`).waitFor();
    await a.screenshot({ path: path.join(SHOTS, "landing.png") });
  });

  await step("alice signs up and creates a community", async () => {
    await signUp(a, alice, `${base}/login?mode=signup`);
    await a.waitForURL(`${base}/app`);
    await a.getByLabel("Name").fill("Crew " + run);
    await a.locator("#slug").fill(slug);
    await a.getByRole("button", { name: "Create community" }).click();
    await a.waitForURL(`${base}/c/${slug}/general`);
    await a.getByRole("heading", { name: "Welcome to #general" }).waitFor();
  });

  await step("alice posts", async () => {
    await send(a, "First! Plan for the meetup?");
    await a.getByText("First! Plan for the meetup?").waitFor();
  });

  await step("alice makes an invite link", async () => {
    await a.goto(`${base}/c/${slug}/settings`);
    await a.getByRole("button", { name: "Create invite link" }).click();
    const code = a.locator("code", { hasText: "/invite/" }).first();
    await code.waitFor();
    invite = (await code.textContent()).trim();
    if (!invite.includes("/invite/")) throw new Error(`bad invite: ${invite}`);
  });

  await step("bob signs up through the invite and lands in the room", async () => {
    await signUp(b, bob, invite.replace(/^https?:\/\/[^/]+/, base));
    await b.waitForURL(`${base}/c/${slug}/general`);
    await b.getByText("First! Plan for the meetup?").waitFor();
  });

  await step("messages arrive live, with mentions highlighted", async () => {
    await a.goto(`${base}/c/${slug}/general`);
    await a.getByText("First! Plan for the meetup?").waitFor();
    await a.waitForTimeout(1500); // let the realtime subscription join
    await send(b, `Saturday works @${alice.username}`);
    await a.getByText("Saturday works").waitFor();
    await a.locator(`span:text-is("@${alice.username}")`).waitFor();
  });

  await step("reactions sync", async () => {
    const msg = a.locator("[id^=m-]", { hasText: "Saturday works" });
    await msg.hover();
    await msg.getByRole("button", { name: "React" }).click();
    await msg.getByRole("button", { name: "React 🔥" }).click();
    await b.locator("[id^=m-]", { hasText: "Saturday works" }).getByRole("button", { name: "🔥 1" }).waitFor();
  });

  await step("thread replies show up live and the thread closes with an outcome", async () => {
    const root = b.locator("[id^=m-]", { hasText: "First! Plan for the meetup?" });
    await root.hover();
    await root.getByRole("button", { name: "Reply in thread" }).click();
    const reply = b.getByPlaceholder("Reply…");
    await reply.fill("Park at 2pm?");
    await reply.press("Enter");
    await a.locator("[id^=m-]", { hasText: "First! Plan for the meetup?" }).getByRole("button", { name: /1 reply/ }).waitFor();
    await a.locator("[id^=m-]", { hasText: "First! Plan for the meetup?" }).getByRole("button", { name: /1 reply/ }).click();
    await a.getByText("Park at 2pm?").waitFor();
    await a.getByRole("button", { name: "Close with an outcome" }).click();
    await a.getByLabel("What was decided?").fill("Meetup Saturday 2pm at the park");
    await a.getByRole("button", { name: "Close thread" }).click();
    await b.getByText("Meetup Saturday 2pm at the park").first().waitFor();
  });

  await step("the outcome is pinned to the room board", async () => {
    await b.getByRole("button", { name: "Room board" }).click();
    await b.locator("aside").getByText("decision", { exact: true }).first().waitFor();
    await b.locator("aside").getByText("Meetup Saturday 2pm at the park").first().waitFor();
    await b.screenshot({ path: path.join(SHOTS, "board.png") });
  });

  await step("search finds old messages", async () => {
    await a.getByRole("button", { name: "Search" }).first().click();
    await a.getByPlaceholder("Search every message, ever").fill("saturday");
    await a.getByPlaceholder("Search every message, ever").press("Enter");
    await a.locator("aside a", { hasText: "Saturday works" }).waitFor();
  });

  await step("members can't start posts in announcements", async () => {
    await b.goto(`${base}/c/${slug}/announcements`);
    await b.getByText("You can still reply in threads").waitFor();
  });

  await step("catch-up recap after time away", async () => {
    await send(a, "Bringing snacks");
    await a.goto(`${base}/c/${slug}/general`);
    await b.goto(`${base}/c/${slug}/general`);
    await b.getByText(/While you were gone/).waitFor();
    await b.screenshot({ path: path.join(SHOTS, "room.png") });
  });


  await step("@ctrl researches on the web and answers in a thread", async () => {
    await b.goto(`${base}/c/${slug}/general`);
    await a.goto(`${base}/c/${slug}/general`);
    await a.waitForTimeout(1500);
    await send(b, "@ctrl research the test topic for us");
    const ask = a.locator("[id^=m-]", { hasText: "research the test topic" });
    await ask.getByRole("button", { name: /1 reply/ }).waitFor({ timeout: 30_000 });
    await ask.getByRole("button", { name: /1 reply/ }).click();
    const panel = a.locator("aside", { hasText: "Thread" });
    await panel.getByText("Test Topic Weekly").waitFor();
    await panel.getByText("AI", { exact: true }).first().waitFor();
    await a.screenshot({ path: path.join(SHOTS, "ctrl.png") });
  });

  await step("@openctrl answers from the docs with a link", async () => {
    const box = a.getByPlaceholder("Reply… (@ctrl to ask AI)");
    await box.fill("@openctrl how do I make someone a mod?");
    await box.press("Enter");
    const panel = a.locator("aside", { hasText: "Thread" });
    await panel.getByText(/From the docs: admins and the owner change roles/).waitFor({ timeout: 30_000 });
    const text = await panel.innerText();
    if (/<think>|\*\*/.test(text)) throw new Error("hidden reasoning or markdown leaked into the answer");
    if (!text.includes("/docs/ctrl-room/roles-and-moderation")) throw new Error("no docs link in the answer");
    if (!text.includes(`@${alice.username}`)) throw new Error("answer inside a thread should @mention the asker");
  });

  await step("composer suggests the AI helpers", async () => {
    const box = b.getByPlaceholder(/^Message #general/);
    await box.fill("@ope");
    await b.getByRole("option", { name: /OpenCtrl.*help with OpenCtrl apps/ }).waitFor();
    await box.fill("");
  });

  await step("docs site lists the apps and pages", async () => {
    await b.goto(`${base}/docs`);
    await b.getByRole("heading", { name: "How can we help?" }).waitFor();
    await b.getByRole("link", { name: /Roles and moderation/ }).first().click();
    await b.waitForURL(`${base}/docs/ctrl-room/roles-and-moderation`);
    await b.locator("#remove-or-ban").waitFor();
    await b.screenshot({ path: path.join(SHOTS, "docs.png") });
  });

  await step("voice room shows the call bar", async () => {
    await a.goto(`${base}/c/${slug}/lounge`);
    await a.getByText("Call in #lounge").waitFor();
  });

  await step("a new room is still listed after going to /app and back", async () => {
    await a.goto(`${base}/c/${slug}/settings#rooms`);
    await a.getByLabel("Room name").fill("planning");
    await a.getByRole("button", { name: "Add room" }).click();
    await a.getByText("#planning added.").waitFor();
    const nav = a.getByRole("navigation", { name: "Communities" });
    // client-side navigation both ways, so the router cache is what's being tested
    await nav.getByTitle("All communities").click();
    await a.waitForURL(`${base}/app`);
    await a.locator(`a[href="/c/${slug}"]`).first().click();
    await a.waitForURL(new RegExp(`/c/${slug}`));
    await a.locator(`aside a[href="/c/${slug}/planning"]`).waitFor();
    await a.goBack();
    await a.waitForURL(`${base}/app`);
    await a.goForward();
    await a.locator(`aside a[href="/c/${slug}/planning"]`).waitFor();
    // and other members see it live
    await b.locator(`aside a[href="/c/${slug}/planning"]`).waitFor();
  });

  await step("rooms: edit the description, pin, sections", async () => {
    await a.goto(`${base}/c/${slug}/planning`);
    await a.getByRole("button", { name: "Edit room" }).click();
    await a.getByLabel("Description").fill("Plans for the meetup. Notes: https://example.com/notes");
    await a.getByRole("button", { name: "Save" }).click();
    await a.getByRole("button", { name: "Room info" }).click();
    await a.getByRole("link", { name: "https://example.com/notes" }).waitFor();
    await b.goto(`${base}/c/${slug}/general`);
    await b.getByRole("button", { name: "Pin planning" }).click({ force: true });
    await b.getByRole("heading", { name: "Pinned" }).waitFor();
    await b.reload();
    await b.getByRole("heading", { name: "Pinned" }).waitFor();
    await a.getByRole("heading", { name: "Pinned" }).waitFor({ state: "detached" });
    await a.goto(`${base}/c/${slug}/settings#rooms`);
    await a.getByLabel("New section name").fill("Events");
    await a.getByRole("button", { name: "Add section" }).click();
    await a.getByLabel("Move general to section").selectOption({ label: "Events" });
    await a.locator("aside").getByRole("button", { name: "Events" }).waitFor();
    await a.screenshot({ path: path.join(SHOTS, "rooms-sections.png") });
  });

  await step("strangers can't see the community", async () => {
    const c = await newPerson();
    await signUp(c, { name: "Carol", username: `carol${run}`, email: `carol-${run}@example.com` }, `${base}/login?mode=signup`);
    await c.waitForURL(`${base}/app`);
    const res = await c.goto(`${base}/c/${slug}/general`);
    if (res.status() !== 404) throw new Error(`expected 404, got ${res.status()}`);
  });

  console.log(`\n${passed} checks passed. Screenshots in ${SHOTS}`);
} catch {
  exitCode = 1;
} finally {
  await browser.close();
  mock?.close();
  if (server) {
    try {
      process.kill(-server.pid); // the whole group, so next-server does not outlive the run
    } catch {}
  }
}
process.exit(exitCode);
