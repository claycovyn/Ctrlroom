import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_LINK_TYPES, confirmCopy, destinationFor, isEmailLinkType, resolveNext } from "@/lib/authLinks";
import { safeNext } from "@/lib/safeNext";

const SITE = "https://ctrlroom.example";
const O = [SITE];

describe("safeNext", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
    expect(safeNext("/c/crew?m=1")).toBe("/c/crew?m=1");
  });
  it("refuses anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, undefined, 3]) {
      expect(safeNext(bad)).toBe("/app");
    }
  });
});

describe("resolveNext", () => {
  it("takes relative paths as they are", () => {
    expect(resolveNext("/invite/abc", O)).toBe("/invite/abc");
  });
  it("defaults to /app", () => {
    expect(resolveNext(undefined, O)).toBe("/app");
    expect(resolveNext("", O)).toBe("/app");
    expect(resolveNext("nope", O)).toBe("/app");
  });
  it("turns a full URL on this site into a path", () => {
    expect(resolveNext(`${SITE}/invite/abc`, O)).toBe("/invite/abc");
    expect(resolveNext(`${SITE}/c/crew?m=1`, O)).toBe("/c/crew?m=1");
  });
  it("sends the bare site URL (Supabase's RedirectTo when none was given) to /app", () => {
    expect(resolveNext(SITE, O)).toBe("/app");
    expect(resolveNext(`${SITE}/`, O)).toBe("/app");
  });
  it("unwraps the sign-up redirect back to its own next", () => {
    // What {{ .RedirectTo }} holds after sign-up, once the outer query string is decoded.
    expect(resolveNext(`${SITE}/auth/callback?next=/invite/abc`, O)).toBe("/invite/abc");
    expect(resolveNext(`${SITE}/auth/callback?next=%2Finvite%2Fabc`, O)).toBe("/invite/abc");
    expect(resolveNext(`${SITE}/auth/confirm?next=/auth/reset`, O)).toBe("/auth/reset");
    expect(resolveNext(`${SITE}/auth/callback`, O)).toBe("/app");
    expect(resolveNext("/auth/confirm?next=/c/crew", O)).toBe("/c/crew");
  });
  it("round-trips a full template link", () => {
    const redirectTo = `${SITE}/auth/callback?next=${encodeURIComponent("/invite/abc")}`;
    const link = new URL(`${SITE}/auth/confirm?token_hash=h&type=email&next=${redirectTo}`);
    expect(resolveNext(link.searchParams.get("next"), O)).toBe("/invite/abc");
  });
  it("never follows another origin, even through a wrapper", () => {
    expect(resolveNext("https://evil.example/app", O)).toBe("/app");
    expect(resolveNext(`http://ctrlroom.example/app`, O)).toBe("/app");
    expect(resolveNext(`${SITE}/auth/callback?next=https://evil.example`, O)).toBe("/app");
    expect(resolveNext(`${SITE}/auth/callback?next=//evil.example`, O)).toBe("/app");
    expect(resolveNext("javascript:alert(1)", O)).toBe("/app");
  });
  it("stops unwrapping nested hops", () => {
    const deep = `${SITE}/auth/confirm?next=${encodeURIComponent(`${SITE}/auth/callback?next=${encodeURIComponent(`${SITE}/auth/confirm?next=/x`)}`)}`;
    expect(resolveNext(deep, O)).toBe("/app");
  });
});

describe("destinationFor", () => {
  it("sends recovery and invite links to the set-password page", () => {
    expect(destinationFor("recovery", "/app")).toBe("/auth/reset");
    expect(destinationFor("recovery", "/auth/reset")).toBe("/auth/reset");
    expect(destinationFor("invite", "/app")).toBe("/auth/reset");
    expect(destinationFor("invite", "/invite/abc")).toBe("/auth/reset?next=%2Finvite%2Fabc");
  });
  it("sends the other link types to next", () => {
    for (const t of ["signup", "email", "magiclink", "email_change"] as const) {
      expect(destinationFor(t, "/invite/abc")).toBe("/invite/abc");
      expect(destinationFor(t, "/app")).toBe("/app");
    }
    expect(destinationFor(null, "/c/crew")).toBe("/c/crew");
  });
});

describe("link types", () => {
  it("accepts only Supabase's email types", () => {
    for (const t of EMAIL_LINK_TYPES) expect(isEmailLinkType(t)).toBe(true);
    for (const t of ["sms", "phone_change", "", "EMAIL", null]) expect(isEmailLinkType(t)).toBe(false);
  });
  it("has words for every type", () => {
    for (const t of [...EMAIL_LINK_TYPES, null]) {
      const c = confirmCopy(t);
      expect(c.title && c.body && c.button).toBeTruthy();
    }
  });
});

describe("email templates", () => {
  const expected: Record<string, string> = {
    confirmation: "type=email&next={{ .RedirectTo }}",
    magic_link: "type=email&next={{ .RedirectTo }}",
    recovery: "type=recovery&next=/auth/reset",
    email_change: "type=email_change&next={{ .RedirectTo }}",
    invite: "type=invite&next={{ .RedirectTo }}",
  };
  for (const [name, tail] of Object.entries(expected)) {
    it(`${name} links to /auth/confirm with a token_hash`, () => {
      const html = readFileSync(path.resolve(__dirname, `../supabase/templates/${name}.html`), "utf8");
      const url = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&${tail}`;
      expect(html).not.toContain("{{ .ConfirmationURL }}");
      // Button, fallback link href and fallback link text all use the same URL.
      expect(html.split(url).length - 1).toBe(3);
      const type = new URLSearchParams(tail).get("type");
      expect(isEmailLinkType(type)).toBe(true);
    });
  }
});
