// Two people chatting live: sign up, create a community, invite, realtime messages,
// mentions, reactions, threads with outcomes, the board, search and announcement rooms.
//
// Needs: `npx supabase start`, `.env.local` pointing at it, `npm run build`.
// Usage: node scripts/e2e.mjs [baseUrl]   (starts `next start` on :3100 when no baseUrl)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SHOTS = process.env.E2E_SHOTS ?? path.resolve("e2e-shots");
mkdirSync(SHOTS, { recursive: true });

let server;
let base = process.argv[2];
if (!base) {
  base = "http://localhost:3100";
  server = spawn("node_modules/.bin/next", ["start", "-p", "3100"], { stdio: ["ignore", "pipe", "inherit"], env: process.env, detached: true });
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
    await a.waitForURL(`${base}/c/${slug}/feed`);
    await a.goto(`${base}/c/${slug}/general`);
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
    await b.waitForURL(`${base}/c/${slug}/feed`);
    await b.goto(`${base}/c/${slug}/general`);
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


  // ── community hub: feed, answers, points, classroom, calendar, leaderboard
  let postUrl;
  await step("bob asks a question in the feed and alice sees it arrive", async () => {
    await a.goto(`${base}/c/${slug}/feed`);
    await a.getByText("Write something…").waitFor();
    await a.waitForTimeout(1500);
    await b.goto(`${base}/c/${slug}/feed`);
    await b.getByText("Write something…").click();
    await b.getByLabel("Post title").fill("How do I get started?");
    await b.getByLabel("Post body").fill(`New here. Any tips @${alice.username}?`);
    await b.getByLabel("Category").selectOption({ label: "❓ Questions" });
    await b.getByRole("button", { name: "Post", exact: true }).click();
    await b.waitForURL(/\/feed\/[0-9a-f-]{36}$/);
    postUrl = b.url();
    await a.getByRole("button", { name: /1 new post/ }).click();
    await a.getByText("How do I get started?").waitFor();
  });

  await step("alice gets a notification, likes the post and comments; bob sees it live", async () => {
    await a.getByRole("button", { name: /Notifications, 1 unread/ }).waitFor();
    await a.goto(postUrl);
    await a.getByRole("button", { name: "Like" }).first().click();
    await a.getByPlaceholder("Write a comment…").fill("Start with the Classroom, then say hi in #general.");
    await a.getByPlaceholder("Write a comment…").press("Enter");
    await b.getByText("Start with the Classroom, then say hi in #general.").waitFor();
  });

  await step("bob marks alice's comment as the answer and she earns 5 points", async () => {
    await b.getByRole("button", { name: "Mark as answer" }).click();
    await b.getByText("Answer", { exact: true }).waitFor();
    await b.locator('[id^="c-"] [title="Level 2"]').waitFor(); // her badge updates to level 2 right away
    await a.reload();
    await a.getByText("Answer", { exact: true }).waitFor();
    await a.getByText(/· 5 pts/).waitFor();
    await b.screenshot({ path: path.join(SHOTS, "post.png") });
  });

  await step("feed shows the answered question with its like", async () => {
    await b.goto(`${base}/c/${slug}/feed`);
    const card = b.locator("a", { hasText: "How do I get started?" });
    await card.getByText("Answered").waitFor();
    await card.getByRole("button", { name: "Like" }).waitFor();
    await b.screenshot({ path: path.join(SHOTS, "feed.png") });
  });

  await step("alice builds and publishes a course", async () => {
    await a.goto(`${base}/c/${slug}/classroom`);
    await a.getByRole("button", { name: "New course" }).click();
    await a.getByLabel("Course title").fill("Start here");
    await a.getByLabel("Description").fill("Everything you need for week one.");
    await a.getByRole("button", { name: "Create and add lessons" }).click();
    await a.waitForURL(/\/classroom\/[0-9a-f-]{36}/);
    a.once("dialog", (d) => d.accept("Week 1"));
    await a.getByRole("button", { name: "Add section" }).click();
    a.once("dialog", (d) => d.accept("Welcome to the crew"));
    await a.getByRole("button", { name: "Add lesson" }).click();
    await a.getByLabel("Video link (YouTube, Vimeo or Loom)").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await a.getByLabel("Notes").fill("Read the board in #general and introduce yourself in the feed.");
    await a.getByRole("button", { name: "Save lesson" }).click();
    await a.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]').waitFor();
    await a.getByRole("button", { name: "Publish" }).click();
    await a.getByRole("button", { name: "Unpublish" }).waitFor();
  });

  await step("bob finishes the lesson and the course shows 100%", async () => {
    await b.goto(`${base}/c/${slug}/classroom`);
    await b.getByText("0 of 1 lessons").waitFor();
    await b.getByRole("link", { name: /Start here/ }).click();
    await b.getByRole("button", { name: "Mark complete" }).click();
    await b.getByText("100% complete").waitFor();
    await b.screenshot({ path: path.join(SHOTS, "course.png") });
  });

  await step("alice schedules an event in the voice room; bob RSVPs and downloads it", async () => {
    await a.goto(`${base}/c/${slug}/calendar`);
    await a.getByRole("button", { name: "New event" }).click();
    await a.getByLabel("Event title").fill("Office hours");
    await a.getByRole("button", { name: "Create event" }).click();
    await a.getByRole("heading", { name: "Office hours" }).waitFor();
    await b.goto(`${base}/c/${slug}/calendar`);
    const card = b.locator("li", { hasText: "Office hours" });
    await card.getByRole("link", { name: /#lounge/ }).waitFor();
    await card.getByRole("button", { name: "Going" }).click();
    await card.getByText("1 going").waitFor();
    const ics = await b.request.get(await card.getByRole("link", { name: "Add to calendar" }).getAttribute("href").then((h) => base + h));
    if (!(await ics.text()).includes("SUMMARY:Office hours")) throw new Error("bad .ics");
    await b.screenshot({ path: path.join(SHOTS, "calendar.png") });
  });

  await step("leaderboard ranks alice for the answer", async () => {
    await b.goto(`${base}/c/${slug}/leaderboard`);
    const first = b.locator("ol li").first();
    await first.getByText(alice.name).waitFor();
    await b.getByText("How points work").waitFor();
    await b.screenshot({ path: path.join(SHOTS, "leaderboard.png") });
  });

  await step("voice room shows the call bar", async () => {
    await a.goto(`${base}/c/${slug}/lounge`);
    await a.getByText("Call in #lounge").waitFor();
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
  if (server) {
    try {
      process.kill(-server.pid); // the whole group, so next-server does not outlive the run
    } catch {}
  }
}
process.exit(exitCode);
