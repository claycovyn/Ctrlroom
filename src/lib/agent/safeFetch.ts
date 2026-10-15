import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for addresses a server-side fetch must never reach (loopback, private, link-local, …). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

const allowPrivate = () => process.env.AGENT_UNSAFE_ALLOW_PRIVATE_URLS === "1"; // local tests only

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http and https links can be read");
  if (url.username || url.password) throw new Error("links with passwords can't be read");
  if (url.port && !["80", "443"].includes(url.port) && !allowPrivate()) throw new Error("that port isn't allowed");
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("that address isn't public");
}

/**
 * Fetches a public web page for the agent: http(s) only, public addresses only (checked on
 * every redirect), short timeout, size cap, text content types only.
 */
export async function safeFetchText(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ url: string; contentType: string; body: string }> {
  const { timeoutMs = 10_000, maxBytes = 1_500_000 } = opts;
  let url = new URL(raw);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "CtrlRoomBot/1.0 (+https://github.com/claycovyn/Ctrlroom)", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`the page returned ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/|json|xml/.test(contentType)) throw new Error("that link isn't a web page");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
    return { url: url.toString(), contentType, body: new TextDecoder().decode(Buffer.concat(chunks)) };
  }
  throw new Error("too many redirects");
}

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Fetches a public image (link preview pictures): the same rules as safeFetchText (http(s), public addresses checked on
 * every redirect, a time limit), PNG, JPEG, WebP or GIF only (never SVG), and a size cap. Over the cap is an error.
 */
export async function safeFetchImage(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ contentType: string; bytes: Buffer }> {
  const { timeoutMs = 8_000, maxBytes = 4_000_000 } = opts;
  let url = new URL(raw);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": "CtrlRoomBot/1.0 (+https://github.com/claycovyn/Ctrlroom)", Accept: "image/webp,image/png,image/jpeg,image/gif" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`the image returned ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(contentType)) throw new Error("that isn't a picture");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("the picture is too big");
      }
      chunks.push(value);
    }
    return { contentType, bytes: Buffer.concat(chunks) };
  }
  throw new Error("too many redirects");
}
