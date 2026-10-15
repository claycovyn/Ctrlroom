// Link previews for posts: the page's title, description, picture and site name, from its Open Graph / Twitter / HTML
// tags. Fetched on the server (src/app/api/link-preview) with the AI helpers' safe fetch: public addresses only. The
// picture is served through /api/link-preview/image, so the site never sees who's looking.

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  /** The page's picture (an absolute http(s) address), or null. */
  image: string | null;
  site: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return safeChar(parseInt(k.slice(2), 16), m);
    if (k.startsWith("#")) return safeChar(parseInt(k.slice(1), 10), m);
    return ENTITIES[k] ?? m;
  });
}

function safeChar(code: number, fallback: string): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : fallback;
}

const clean = (s: string | undefined, max: number) => decodeEntities(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The attributes of one tag, lower-cased names: <meta property="og:title" content="…"> → { property, content }. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return out;
}

/** An absolute http(s) address from a page's (maybe relative) one, or null. */
function absolute(raw: string, base: string): string | null {
  try {
    const u = new URL(decodeEntities(raw.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reads the preview from a page's HTML (only its <head> matters; the rest is ignored). Null when there's nothing. */
export function parsePreview(html: string, pageUrl: string): LinkPreview | null {
  const end = html.search(/<\/head>/i);
  const head = (end >= 0 ? html.slice(0, end) : html).slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || "").toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = clean(meta.get("og:title") || meta.get("twitter:title") || titleTag, 200);
  const description = clean(meta.get("og:description") || meta.get("twitter:description") || meta.get("description"), 300);
  const rawImage = meta.get("og:image:secure_url") || meta.get("og:image") || meta.get("twitter:image") || meta.get("twitter:image:src");
  const image = rawImage ? absolute(rawImage, pageUrl) : null;
  let site = clean(meta.get("og:site_name"), 80);
  if (!site) {
    try {
      site = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      site = "";
    }
  }
  if (!title && !description && !image) return null;
  return { url: pageUrl, title: title || site, description, image, site };
}

/** A link a preview may be made for: http(s), no password, not too long. */
export function previewableUrl(raw: string | null): string | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
