import { describe, expect, it } from "vitest";
import { detectOs, formatSize, parseRelease } from "@/lib/desktopDownloads";

const asset = (name: string, size = 5_000_000) => ({
  name,
  size,
  browser_download_url: `https://github.com/claycovyn/ctrlroom-downloads/releases/download/desktop-v0.1.0/${encodeURIComponent(name)}`,
});

const release = {
  tag_name: "desktop-v0.1.0",
  html_url: "https://github.com/claycovyn/ctrlroom-downloads/releases/tag/desktop-v0.1.0",
  assets: [
    asset("Ctrl Room_0.1.0_x64_en-US.msi"),
    asset("Ctrl Room_0.1.0_x64-setup.exe"),
    asset("Ctrl Room_0.1.0_universal.dmg"),
    asset("Ctrl Room_universal.app.tar.gz"),
    asset("Ctrl Room_0.1.0_amd64.deb"),
    asset("Ctrl Room_0.1.0_amd64.AppImage"),
    asset("Ctrl Room-0.1.0-1.x86_64.rpm"),
  ],
};

describe("parseRelease", () => {
  it("lists the installers, with the main one per OS first", () => {
    const r = parseRelease(release)!;
    expect(r.version).toBe("0.1.0");
    expect(r.installers.map((i) => [i.os, i.name, i.primary])).toEqual([
      ["windows", "Ctrl Room_0.1.0_x64-setup.exe", true],
      ["windows", "Ctrl Room_0.1.0_x64_en-US.msi", false],
      ["mac", "Ctrl Room_0.1.0_universal.dmg", true],
      ["linux", "Ctrl Room_0.1.0_amd64.AppImage", true],
      ["linux", "Ctrl Room_0.1.0_amd64.deb", false],
      ["linux", "Ctrl Room-0.1.0-1.x86_64.rpm", false],
    ]);
  });

  it("leaves out archives, off-site links, drafts and empty releases", () => {
    const r = parseRelease({ ...release, assets: [{ ...asset("x-setup.exe"), browser_download_url: "https://evil.example/x-setup.exe" }] });
    expect(r).toBeNull();
    expect(parseRelease({ ...release, draft: true })).toBeNull();
    expect(parseRelease({ ...release, assets: [asset("Ctrl Room_universal.app.tar.gz")] })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});

describe("detectOs", () => {
  it("reads the computer from the user agent", () => {
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18 Safari/605.1.15")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64) Firefox/140")).toBe("linux");
  });
  it("gives phones and tablets nothing", () => {
    expect(detectOs("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBeNull();
    expect(detectOs("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBeNull();
    expect(detectOs("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBeNull();
    expect(detectOs(null)).toBeNull();
  });
});

describe("formatSize", () => {
  it("shows MB", () => expect(formatSize(5_242_880)).toBe("5.0 MB"));
  it("shows nothing for unknown", () => expect(formatSize(0)).toBe(""));
});
