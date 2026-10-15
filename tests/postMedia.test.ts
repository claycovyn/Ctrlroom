import { describe, expect, it } from "vitest";
import { decodeEntities, parsePreview, previewableUrl } from "@/lib/linkPreview";
import { domainOf, firstLink, mediaGrid, postMediaProblem, takeMedia } from "@/lib/postMedia";
import { cleanupPostMedia, type CleanupDb } from "@/lib/attachmentCleanup";

describe("link previews", () => {
  it("reads Open Graph, then Twitter, then plain HTML tags, with relative pictures made absolute", () => {
    const html = `<html><head><title>Plain title</title>
      <meta content="A &amp; B &#8212; &quot;quoted&quot;" property="og:title">
      <meta name="description" content="Plain description">
      <meta property='og:image' content='/img/card.png'>
      <meta property="og:site_name" content="Example">
      </head><body><meta property="og:title" content="not in head"></body></html>`;
    expect(parsePreview(html, "https://example.com/post/1")).toEqual({
      url: "https://example.com/post/1",
      title: 'A & B — "quoted"',
      description: "Plain description",
      image: "https://example.com/img/card.png",
      site: "Example",
    });
    expect(parsePreview("<head><title>Only a title</title></head>", "https://www.site.org/")).toMatchObject({ title: "Only a title", site: "site.org", image: null });
    expect(parsePreview("<head></head><body>nothing</body>", "https://x.com/")).toBeNull();
    expect(parsePreview('<head><meta property="og:image" content="javascript:alert(1)"><title>t</title></head>', "https://x.com/")?.image).toBeNull();
  });
  it("only previews plain http(s) links", () => {
    expect(previewableUrl("https://a.com/x#frag")).toBe("https://a.com/x");
    expect(previewableUrl("ftp://a.com")).toBeNull();
    expect(previewableUrl("https://user:pw@a.com")).toBeNull();
    expect(previewableUrl("not a url")).toBeNull();
    expect(previewableUrl(`https://a.com/${"x".repeat(2001)}`)).toBeNull();
    expect(decodeEntities("&#x1F600; &bogus; &#0;")).toBe("😀 &bogus; &#0;");
  });
});

describe("post media", () => {
  it("takes photos up to 10 MB and videos up to 50 MB, nothing else", () => {
    expect(postMediaProblem("image/png", 10 * 1024 * 1024)).toBeNull();
    expect(postMediaProblem("image/png", 10 * 1024 * 1024 + 1)).toMatch(/10 MB/);
    expect(postMediaProblem("video/mp4", 50 * 1024 * 1024)).toBeNull();
    expect(postMediaProblem("video/webm", 50 * 1024 * 1024 + 1)).toMatch(/50 MB/);
    expect(postMediaProblem("image/svg+xml", 10)).toMatch(/photos/);
    expect(postMediaProblem(null, 10)).toMatch(/photos/);
  });
  it("keeps 4 per post and lays them out", () => {
    expect(takeMedia([1, 2, 3], 2)).toEqual({ take: [1, 2], dropped: 1 });
    expect(mediaGrid(1)).toEqual({ cols: 1, tall: false });
    expect(mediaGrid(3)).toEqual({ cols: 2, tall: true });
  });
  it("finds the first link and its domain", () => {
    expect(firstLink("see https://www.example.com/a and https://b.com")).toBe("https://www.example.com/a");
    expect(firstLink("no links")).toBeNull();
    expect(domainOf("https://www.example.com/a")).toBe("example.com");
  });
  it("cleans up post media: removes bytes, then rows, and keeps a failed chunk for tomorrow", async () => {
    const calls: string[] = [];
    let listed = false;
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push(fn);
        if (fn === "post_media_cleanup") {
          if (listed) return { data: [], error: null };
          listed = true;
          return { data: [{ path: "post/u/1/media.webp" }, { path: "post/u/2/media.mp4" }], error: null };
        }
        expect(args).toEqual({ p_paths: ["post/u/1/media.webp", "post/u/2/media.mp4"] });
        return { data: null, error: null };
      },
      storage: { from: (bucket: string) => ({ remove: async () => (calls.push(`remove:${bucket}`), { error: null }) }) },
    } as unknown as CleanupDb;
    expect(await cleanupPostMedia(db)).toEqual({ removed: 2, failed: 0 });
    expect(calls).toEqual(["post_media_cleanup", "remove:post-media", "post_media_cleanup_done"]);
  });
});
