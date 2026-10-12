/**
 * Turns a YouTube, Vimeo or Loom share link into an embeddable player URL.
 * Anything else returns null and is shown as a plain link.
 */
export function videoEmbed(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,64}$/.test(s) ? s : null);

  if (host === "youtu.be") {
    const v = id(url.pathname.slice(1));
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const v = id(url.searchParams.get("v")) ?? (["embed", "shorts", "live"].includes(parts[0]) ? id(parts[1]) : null);
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = url.pathname.split("/").filter(Boolean).find((p) => /^\d{5,12}$/.test(p));
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  if (host === "loom.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const v = ["share", "embed"].includes(parts[0]) ? id(parts[1]) : null;
    return v ? `https://www.loom.com/embed/${v}` : null;
  }
  return null;
}
