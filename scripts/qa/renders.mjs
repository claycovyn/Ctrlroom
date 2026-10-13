// Which components re-render, and how often, for common events (opening the rooms, a presence update, someone
// typing, a new message, typing in the composer). Uses the harness's ?count=1 fiber counter.
// Usage: node scripts/qa/renders.mjs [--json out.json]
import { writeFileSync } from "node:fs";
import { BASE, chromiumPhone, roomPainted, server, sleep } from "./lib.mjs";

const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const srv = await server();
const { browser, page } = await chromiumPhone();
const results = {};
const reset = () => page.evaluate(() => (window.__perf.renders = {}, window.__perf.commits = []));
const take = async (name) => {
  await sleep(400);
  const r = await page.evaluate(() => ({ renders: window.__perf.renders, ms: window.__perf.commits.reduce((a, c) => a + c.ms, 0) }));
  const top = Object.entries(r.renders).sort((a, b) => b[1] - a[1]);
  const total = top.reduce((a, [, n]) => a + n, 0);
  results[name] = { total, commitMs: +r.ms.toFixed(1), MessageItem: r.renders.MessageItem ?? 0, top: Object.fromEntries(top.slice(0, 8)) };
  console.log(name.padEnd(22), JSON.stringify(results[name]));
};
try {
  await page.goto(`${BASE}/c/night-shift/general?count=1`);
  await roomPainted(page, "general");
  await sleep(1500);

  await reset();
  await page.click("button[aria-label='Open menu']");
  await take("open rooms");
  await reset();
  await page.click(".cr-peek");
  await take("close rooms");

  await reset();
  await page.evaluate(() => {
    const p = window.__data.peers();
    const k = Object.keys(p)[0];
    p[k][0].status = "away";
    window.__sim.setPeers(p);
  });
  await take("presence change");

  await reset();
  await page.evaluate(() => window.__sim.emit(`room:${window.__data.rooms[0].id}`, "typing", { user_id: window.__data.profiles[3].id, name: "Priya Shah" }));
  await take("someone typing");

  await reset();
  await page.evaluate(() => {
    const r = window.__data.rooms[0];
    window.__sim.emit(`room:${r.id}`, "message", { id: "f1000000-0000-4000-8000-000000000001", room_id: r.id, community_id: r.community_id, author_id: window.__data.profiles[4].id, parent_id: null, body: "new one", reply_count: 0, last_reply_at: null, resolved_at: null, resolved_by: null, outcome: null, edited_at: null, deleted_at: null, created_at: new Date().toISOString(), attachments: [] });
  });
  await take("new message");

  await reset();
  await page.locator("textarea").click();
  await page.keyboard.type("hello there", { delay: 30 });
  await take("type 11 chars");

  await reset();
  await page.evaluate(() => window.__sim.emit(`community:${window.__data.communities[0].id}`, "activity", { room_id: window.__data.rooms[3].id, author_id: window.__data.profiles[2].id, thread: false }));
  await take("activity elsewhere");

  await reset();
  await sleep(15_500);
  await take("15 s idle");
} finally {
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
  await browser.close();
  srv.close();
}
