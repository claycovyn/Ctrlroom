import { describe, expect, it } from "vitest";
import { desktopLaunch, lastPlaceCookie, launchTarget, validPlace } from "@/lib/lastPlace";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("validPlace", () => {
  it("takes a community or a room path, encoded or not", () => {
    expect(validPlace("/c/night-shift/general")).toBe("/c/night-shift/general");
    expect(validPlace("%2Fc%2Fnight-shift%2Fgeneral")).toBe("/c/night-shift/general");
    expect(validPlace("/c/night-shift")).toBe("/c/night-shift");
  });
  it("refuses anything else: other sites, other paths, junk", () => {
    for (const bad of ["//evil.example/c/x", "https://evil.example", "/admin", "/c/x/y/z", "/c/X Y", "%E0%A4%A", "", null, undefined]) {
      expect(validPlace(bad)).toBeNull();
    }
  });
});

describe("desktopLaunch (the desktop app's window opening)", () => {
  it("one community: its last room, or the community", () => {
    expect(desktopLaunch({ communitySlugs: ["night-shift"], cookie: encodeURIComponent("/c/night-shift/design") })).toBe("/c/night-shift/design");
    expect(desktopLaunch({ communitySlugs: ["night-shift"], cookie: undefined })).toBe("/c/night-shift");
    expect(desktopLaunch({ communitySlugs: ["night-shift"], cookie: "/c/other/general" })).toBe("/c/night-shift");
    expect(desktopLaunch({ communitySlugs: ["night-shift"], cookie: "//evil.example" })).toBe("/c/night-shift");
  });
  it("more than one: messages first; none: the list", () => {
    expect(desktopLaunch({ communitySlugs: ["a", "b"], cookie: "/c/a/general" })).toBe("/app/dm");
    expect(desktopLaunch({ communitySlugs: [], cookie: "/c/a/general" })).toBeNull();
  });
});

describe("launchTarget (Home Screen launch on the server)", () => {
  it("sends a phone launching the app straight to its last room", () => {
    expect(launchTarget({ launch: "1", userAgent: IPHONE, cookie: encodeURIComponent("/c/night-shift/design") })).toBe("/c/night-shift/design");
  });
  it("leaves desktops, plain visits and missing or bad cookies on the list", () => {
    expect(launchTarget({ launch: "1", userAgent: DESKTOP, cookie: "/c/a/b" })).toBeNull();
    expect(launchTarget({ launch: undefined, userAgent: IPHONE, cookie: "/c/a/b" })).toBeNull();
    expect(launchTarget({ launch: "1", userAgent: IPHONE, cookie: undefined })).toBeNull();
    expect(launchTarget({ launch: "1", userAgent: IPHONE, cookie: "//evil.example" })).toBeNull();
  });
  it("the cookie the browser writes reads back as the same place", () => {
    const c = lastPlaceCookie("/c/night-shift/general", true);
    expect(c).toMatch(/^cr_last=[^;]+; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
    const value = c.split(";")[0].split("=")[1];
    expect(validPlace(value)).toBe("/c/night-shift/general");
    expect(lastPlaceCookie("/c/a", false)).not.toContain("Secure");
  });
});
