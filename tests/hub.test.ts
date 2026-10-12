import { describe, expect, it } from "vitest";
import { videoEmbed } from "@/lib/embed";
import { levelFor, levelProgress } from "@/lib/levels";

describe("levels", () => {
  it("matches the database curve", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(4)).toBe(1);
    expect(levelFor(5)).toBe(2);
    expect(levelFor(64)).toBe(3);
    expect(levelFor(65)).toBe(4);
    expect(levelFor(33015)).toBe(9);
    expect(levelFor(10 ** 9)).toBe(9);
  });
  it("reports progress to the next level", () => {
    expect(levelProgress(10)).toEqual({ level: 2, next: 20, progress: 1 / 3, toGo: 10 });
    expect(levelProgress(40000).next).toBeNull();
  });
});

describe("videoEmbed", () => {
  it("handles youtube, vimeo and loom", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(videoEmbed("https://www.loom.com/share/abc123def456")).toBe("https://www.loom.com/embed/abc123def456");
  });
  it("refuses anything else", () => {
    expect(videoEmbed("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbed("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbed("javascript:alert(1)")).toBeNull();
    expect(videoEmbed("https://youtube.com/watch?v=<script>")).toBeNull();
  });
});

import { icsFor } from "@/lib/ics";

describe("icsFor", () => {
  it("writes a valid single-event calendar", () => {
    const ics = icsFor(
      { id: "e1", title: "Office hours; Q&A", description: "Line one\nline two", starts_at: "2026-11-01T18:00:00Z", ends_at: "2026-11-01T19:00:00Z", url: "https://x.app/c/a/calendar" },
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(ics).toContain("DTSTART:20261101T180000Z");
    expect(ics).toContain("DTEND:20261101T190000Z");
    expect(ics).toContain(String.raw`SUMMARY:Office hours\; Q&A`);
    expect(ics).toContain("Line one\\nline two");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});
