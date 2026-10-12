import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const { loadDocs, parseFrontMatter, searchDocs } = await import("@/lib/docs");

describe("docs", () => {
  it("parses front matter", () => {
    expect(parseFrontMatter("---\ntitle: Hi: there\ndescription: x\n---\n# Body")).toEqual({
      meta: { title: "Hi: there", description: "x" },
      body: "# Body",
    });
  });

  it("loads every app and page", () => {
    const apps = loadDocs();
    expect(apps.map((a) => a.slug)).toEqual(["openctrl", "ctrl-room"]);
    const room = apps.find((a) => a.slug === "ctrl-room")!;
    expect(room.pages[0]).toMatchObject({ slug: "getting-started", url: "/docs/ctrl-room/getting-started" });
    expect(room.pages.every((p) => p.title && p.description)).toBe(true);
  });

  it("finds the right section", () => {
    expect(searchDocs("how do I make someone a mod")[0]).toMatchObject({ title: "Roles and moderation" });
    expect(searchDocs("invite link expires")[0].title).toBe("Communities and invites");
    expect(searchDocs("share my screen")[0].title).toBe("Voice and video");
    expect(searchDocs("mute a room notifications")[0].title).toBe("Notifications and catch-up");
    expect(searchDocs("zzzz qqqq")).toEqual([]);
  });

  it("links to the section heading", () => {
    const hit = searchDocs("ban someone")[0];
    expect(hit.url).toBe("/docs/ctrl-room/roles-and-moderation#remove-or-ban");
  });
});
