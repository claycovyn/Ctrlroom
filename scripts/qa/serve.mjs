// Serves the QA harness build (scripts/qa/harness/dist) as a single-page app: any path without a file gets
// index.html, so /c/<slug>/<room> deep links work. Images for attachments come from /qa-img/<n>.png.
// Usage: node scripts/qa/serve.mjs [port]   (default 3299). Exported startServer() for the scripts.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QA = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(QA, "../..");
const DIST = path.join(QA, "harness/dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".json": "application/json" };
const IMAGES = ["public/brand/ctrlroom-icon-512.png", "src/app/opengraph-image.png", "public/brand/ctrlroom-icon-192.png", "src/app/twitter-image.png"];

export function startServer(port = 3299) {
  const server = http.createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(DIST, u);
    if (u.startsWith("/sounds/") || u.startsWith("/brand/")) file = path.join(ROOT, "public", u);
    const img = /^\/qa-img\/(\d+)\.png$/.exec(u);
    if (img) file = path.join(ROOT, IMAGES[(Number(img[1]) - 1) % IMAGES.length]);
    let body;
    try {
      body = await readFile(file);
    } catch {
      if (path.extname(u)) {
        res.writeHead(404);
        return res.end();
      }
      file = path.join(DIST, "index.html");
      body = await readFile(file);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 3299);
  await startServer(port);
  console.log(`QA harness on http://127.0.0.1:${port}/c/night-shift/general`);
}
