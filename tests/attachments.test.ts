import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPT,
  DM_CAP_BYTES,
  FILE_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES,
  NOT_ALLOWED,
  SignedUrlCache,
  TOO_BIG,
  TOO_MANY,
  altText,
  extOf,
  fitLongEdge,
  formatBytes,
  gridLayout,
  kindOf,
  pickProblem,
  sendName,
  singleBox,
  sizeProblem,
  sniffType,
  splitAttachments,
  takeFiles,
  uploadError,
  type Attachment,
} from "@/lib/attachments";
import { cleanupAttachments, type CleanupDb } from "@/lib/attachmentCleanup";
import { estimateCost, cleanCosts } from "@/lib/cloud";
import { previewText } from "@/lib/dms";

const sql = readFileSync(path.join(__dirname, "../supabase/migrations/0013_attachments.sql"), "utf8");
const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) typeof p === "string" ? out.push(...p.split("").map((c) => c.charCodeAt(0))) : out.push(...p);
  while (out.length < 16) out.push(0x20);
  return new Uint8Array(out);
};
const text = (s: string) => new TextEncoder().encode(s.padEnd(16, " "));

describe("allowed types", () => {
  it("matches the database's list and the bucket exactly", () => {
    const map = [...sql.matchAll(/when '([a-z0-9]+)' then '([a-z0-9./+-]+)'/g)].map((m) => [m[1], m[2]] as const);
    const ours = FILE_TYPES.flatMap((t) => t.exts.map((e) => [e, t.mime] as const));
    expect(new Map(ours)).toEqual(new Map(map));
    const bucket = /allowed_mime_types\)\s*values \('attachments'.*?array\[([\s\S]*?)\]\)/.exec(sql)![1];
    const listed = [...bucket.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...new Set(FILE_TYPES.map((t) => t.mime))].sort());
  });

  it("never allows SVG, HTML or script", () => {
    for (const bad of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/xml"]) {
      expect(FILE_TYPES.some((t) => t.mime === bad)).toBe(false);
    }
    expect(ACCEPT).not.toMatch(/svg|html/);
  });

  it("uses the limits the database enforces", () => {
    expect(MAX_FILE_BYTES).toBe(10485760);
    expect(sql).toMatch(/file_size_limit[\s\S]*?10485760/);
    expect(MAX_FILES).toBe(10);
    expect(sql).toMatch(/jsonb_array_length\(items\) > 10/);
    expect(DM_CAP_BYTES).toBe(524288000);
    expect(sql).toMatch(/524288000\)/);
  });
});

describe("sniffType", () => {
  it("knows images by their bytes, whatever the name says", () => {
    expect(sniffType(bytes([0x89], "PNG", [13, 10, 26, 10]), "x.png")?.mime).toBe("image/png");
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]), "photo.png")?.mime).toBe("image/jpeg");
    expect(sniffType(bytes("GIF89a"), "a.gif")?.mime).toBe("image/gif");
    expect(sniffType(bytes("RIFF", [0, 0, 0, 0], "WEBP"), "a.webp")?.mime).toBe("image/webp");
  });

  it("knows PDF, audio and video", () => {
    expect(sniffType(bytes("%PDF-1.7"), "doc.pdf")?.mime).toBe("application/pdf");
    expect(sniffType(bytes("RIFF", [0, 0, 0, 0], "WAVE"), "a.wav")?.mime).toBe("audio/wav");
    expect(sniffType(bytes("OggS"), "a.ogg")?.mime).toBe("audio/ogg");
    expect(sniffType(bytes("ID3"), "a.mp3")?.mime).toBe("audio/mpeg");
    expect(sniffType(bytes([0, 0, 0, 0x20], "ftypM4A "), "a.m4a")?.mime).toBe("audio/mp4");
    expect(sniffType(bytes([0, 0, 0, 0x20], "ftypisom"), "clip.mp4")?.mime).toBe("video/mp4");
    expect(sniffType(bytes([0x1a, 0x45, 0xdf, 0xa3]), "clip.webm")?.mime).toBe("video/webm");
  });

  it("tells Office files from plain ZIPs by name once the bytes say ZIP", () => {
    const zip = bytes("PK", [3, 4]);
    expect(sniffType(zip, "plan.docx")?.exts).toContain("docx");
    expect(sniffType(zip, "sheet.xlsx")?.exts).toContain("xlsx");
    expect(sniffType(zip, "deck.pptx")?.exts).toContain("pptx");
    expect(sniffType(zip, "bundle.zip")?.mime).toBe("application/zip");
    expect(sniffType(zip, "notes.txt")?.mime).toBe("application/zip");
  });

  it("accepts text named as text, refuses markup and binary", () => {
    expect(sniffType(text("hello world"), "a.txt")?.mime).toBe("text/plain");
    expect(sniffType(text("# Title"), "README.md")?.mime).toBe("text/markdown");
    expect(sniffType(text("a,b,c"), "data.csv")?.mime).toBe("text/csv");
    expect(sniffType(text("<svg xmlns='x'>"), "a.txt")).toBeNull();
    expect(sniffType(text("  <!DOCTYPE html>"), "a.md")).toBeNull();
    expect(sniffType(text("<script>x</script>"), "a.csv")).toBeNull();
    expect(sniffType(bytes("ab", [0], "cd"), "a.txt")).toBeNull();
    expect(sniffType(text("hello"), "a.exe")).toBeNull();
    expect(sniffType(text("<svg/>"), "a.svg")).toBeNull();
  });
});

describe("limits", () => {
  it("refuses SVG and HTML, empty and huge files, and an eleventh file", () => {
    expect(pickProblem({ name: "a.svg", size: 10 }, 0)).toBe(NOT_ALLOWED);
    expect(pickProblem({ name: "page.HTML", size: 10 }, 0)).toBe(NOT_ALLOWED);
    expect(pickProblem({ name: "a.txt", size: 0 }, 0)).toMatch(/empty/);
    expect(pickProblem({ name: "big.jpg", size: 60 * 1024 * 1024 }, 0)).toBe(TOO_BIG);
    expect(pickProblem({ name: "ok.jpg", size: 30 * 1024 * 1024 }, 0)).toBeNull();
    expect(pickProblem({ name: "a.txt", size: 1 }, 10)).toBe(TOO_MANY);
    expect(sizeProblem(MAX_FILE_BYTES)).toBeNull();
    expect(sizeProblem(MAX_FILE_BYTES + 1)).toBe(TOO_BIG);
  });

  it("takes what fits and says how many were left out", () => {
    expect(takeFiles([1, 2, 3], 8)).toEqual({ take: [1, 2], dropped: 1, message: `${TOO_MANY} One file was left out.` });
    expect(takeFiles([1, 2, 3], 10).dropped).toBe(3);
    expect(takeFiles([1, 2], 0).message).toBeNull();
  });

  it("names files the way they're sent", () => {
    const webp = FILE_TYPES.find((t) => t.mime === "image/webp")!;
    const jpeg = FILE_TYPES.find((t) => t.mime === "image/jpeg")!;
    expect(sendName("IMG_0042.HEIC", webp)).toBe("IMG_0042.webp");
    expect(sendName("photo.jpeg", jpeg)).toBe("photo.jpeg");
    expect(sendName("a/b\\c.png", webp)).toBe("abc.webp");
    expect(sendName("", webp)).toBe("file.webp");
    expect(extOf("Report.Final.PDF")).toBe("pdf");
    expect(extOf("noext")).toBeNull();
  });

  it("shrinks photos to the long edge, never up", () => {
    expect(fitLongEdge({ width: 4032, height: 3024 })).toEqual({ width: 2560, height: 1920 });
    expect(fitLongEdge({ width: 1000, height: 5120 })).toEqual({ width: 500, height: 2560 });
    expect(fitLongEdge({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("explains upload failures plainly", () => {
    expect(uploadError(413, "")).toBe(TOO_BIG);
    expect(uploadError(400, '{"error":"invalid_mime_type"}')).toBe(NOT_ALLOWED);
    expect(uploadError(403, "new row violates row-level security")).toMatch(/can't upload/);
    expect(uploadError(500, "")).toMatch(/Try again/);
  });
});

describe("display", () => {
  const att = (i: number, mime: string, position = i): Attachment => ({
    id: `a${i}`, path: `room/c/r/a${i}/f${i}`, name: `f${i}`, mime, size_bytes: 10, width: null, height: null, alt: null, position,
  });

  it("splits images from files, in order", () => {
    const { images, files } = splitAttachments([att(1, "application/pdf", 2), att(2, "image/png", 1), att(3, "image/gif", 0)]);
    expect(images.map((a) => a.id)).toEqual(["a3", "a2"]);
    expect(files.map((a) => a.id)).toEqual(["a1"]);
    expect(splitAttachments(undefined)).toEqual({ images: [], files: [] });
  });

  it("lays out the grid", () => {
    expect(gridLayout(0).tiles).toEqual([]);
    expect(gridLayout(1)).toMatchObject({ single: true, columns: 1 });
    expect(gridLayout(2)).toMatchObject({ columns: 2, single: false });
    expect(gridLayout(3).tiles.map((t) => t.span)).toEqual([2, 1, 1]);
    expect(gridLayout(4)).toMatchObject({ columns: 2 });
    expect(gridLayout(5).tiles.map((t) => t.span)).toEqual([2, 1, 1, 1, 1]);
    const ten = gridLayout(10);
    expect(ten.columns).toBe(3);
    expect(ten.tiles).toHaveLength(6);
    expect(ten.tiles[5].more).toBe(4);
    expect(ten.tiles.slice(0, 5).every((t) => t.more === 0)).toBe(true);
    // spans fill whole rows
    for (let n = 2; n <= 10; n++) {
      const g = gridLayout(n);
      expect(g.tiles.reduce((s, t) => s + t.span, 0) % g.columns).toBe(0);
    }
  });

  it("sizes a single image to its shape, inside the box, never bigger than it is", () => {
    expect(singleBox(4000, 3000)).toEqual({ width: 360, height: 270 });
    expect(singleBox(1000, 4000)).toEqual({ width: 80, height: 320 });
    expect(singleBox(200, 100)).toEqual({ width: 200, height: 100 });
    expect(singleBox(null, null)).toEqual({ width: 360, height: 270 });
  });

  it("formats sizes and alt text", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(altText(null)).toBe("Image");
    expect(altText("  ")).toBe("Image");
    expect(altText(" A cat ")).toBe("A cat");
    expect(kindOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("sheet");
  });

  it("shows a file-only DM in the inbox", () => {
    const c = { is_group: false, members: [], last_message: { id: "m", author_id: "me", body: "", created_at: "", deleted: false } };
    expect(previewText(c, "me")).toBe("You: Sent a file");
  });
});

describe("SignedUrlCache", () => {
  it("keeps URLs until a minute before they end", () => {
    const c = new SignedUrlCache();
    c.set("p", "u", 3600, 0);
    expect(c.get("p", 1000)).toBe("u");
    expect(c.get("p", 3600_000 - 60_001)).toBe("u");
    expect(c.get("p", 3600_000 - 60_000)).toBeNull();
    expect(c.size).toBe(0);
  });

  it("lists what's missing once, and keys downloads separately", () => {
    const c = new SignedUrlCache();
    c.set("a", "ua", 3600, 0);
    expect(c.missing(["a", "b", "b", "c"], 0)).toEqual(["b", "c"]);
    const k = SignedUrlCache.key("a", "Report.pdf");
    expect(k).not.toBe("a");
    c.set(k, "ud", 3600, 0);
    expect(c.get("a", 0)).toBe("ua");
    c.forget("a");
    expect(c.get("a", 0)).toBeNull();
    expect(c.get(k, 0)).toBeNull();
  });
});

describe("cleanup", () => {
  const fake = (pages: string[][], failRemove = false) => {
    const calls: { rpc: [string, unknown][]; removed: string[][] } = { rpc: [], removed: [] };
    let page = 0;
    const db = {
      rpc: async (name: string, args: unknown) => {
        calls.rpc.push([name, args]);
        if (name === "attachments_cleanup") return { data: (pages[page++] ?? []).map((p) => ({ path: p })), error: null };
        return { data: 1, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            expect(bucket).toBe("attachments");
            calls.removed.push(paths);
            return { error: failRemove ? { message: "down" } : null };
          },
        }),
      },
    } as unknown as CleanupDb;
    return { db, calls };
  };

  it("removes only the paths the database queued, in chunks, then clears them", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `room/c/r/${i}/f.png`);
    const { db, calls } = fake([paths]);
    expect(await cleanupAttachments(db)).toEqual({ removed: 250, failed: 0 });
    expect(calls.removed.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(calls.removed.flat()).toEqual(paths);
    expect(calls.rpc[1]).toEqual(["attachments_cleanup_done", { p_paths: paths }]);
  });

  it("keeps a failed chunk queued", async () => {
    const { db, calls } = fake([["a", "b"]], true);
    expect(await cleanupAttachments(db)).toEqual({ removed: 0, failed: 2 });
    expect(calls.rpc.map((r) => r[0])).toEqual(["attachments_cleanup"]);
  });

  it("does nothing when nothing is queued", async () => {
    const { db, calls } = fake([[]]);
    expect(await cleanupAttachments(db)).toEqual({ removed: 0, failed: 0 });
    expect(calls.removed).toEqual([]);
  });
});

describe("Cloud", () => {
  it("counts file bytes as a cost, not a meter", () => {
    const manifest = JSON.parse(readFileSync(path.join(__dirname, "../openctrl.json"), "utf8"));
    expect(Object.keys(manifest.cloud.meters)).not.toContain("attachment_bytes");
    const costs = cleanCosts({ perGbFiles: 0.02 });
    expect(estimateCost({ attachment_bytes: 5 * 1024 ** 3 }, costs)).toBeCloseTo(0.1);
    expect(estimateCost({ attachment_bytes: 5 * 1024 ** 3 }, cleanCosts({}))).toBe(0);
  });
});
