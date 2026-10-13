import { describe, expect, it } from "vitest";
import {
  communityFallback,
  communityMediaObjectPath,
  communityMediaPath,
  communityMediaProblem,
} from "@/lib/communityMedia";
import { imageFileProblem, publicObjectPath } from "@/lib/media";

const cid = "61000000-0000-0000-0000-000000000001";
const other = "61000000-0000-0000-0000-000000000002";
const base = "https://proj.supabase.co/storage/v1/object/public/community-media/";

describe("communityMediaProblem", () => {
  it("accepts png, jpeg and webp up to 2 MB", () => {
    expect(communityMediaProblem({ type: "image/png", size: 2000 })).toBeNull();
    expect(communityMediaProblem({ type: "image/jpeg", size: 2 * 1024 * 1024 })).toBeNull();
    expect(communityMediaProblem({ type: "image/webp", size: 1 })).toBeNull();
  });
  it("refuses other types, big and empty files", () => {
    expect(communityMediaProblem({ type: "image/gif", size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(communityMediaProblem({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(communityMediaProblem({ type: "image/png", size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/);
    expect(communityMediaProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});

describe("communityMediaPath", () => {
  it("puts the file in the community's folder for its kind", () => {
    expect(communityMediaPath(cid, "icon", "image/png", "abc")).toBe(`${cid}/icon/abc.png`);
    expect(communityMediaPath(cid, "cover", "image/jpeg", "abc")).toBe(`${cid}/cover/abc.jpg`);
    expect(communityMediaPath(cid, "cover", "image/webp")).toMatch(new RegExp(`^${cid}/cover/[0-9a-f-]{36}\.webp$`));
  });
});

describe("communityMediaObjectPath", () => {
  it("finds the object for an image in this community's folder of that kind", () => {
    expect(communityMediaObjectPath(`${base}${cid}/icon/abc.png`, cid, "icon")).toBe(`${cid}/icon/abc.png`);
    expect(communityMediaObjectPath(`${base}${cid}/cover/abc.jpg?v=2`, cid, "cover")).toBe(`${cid}/cover/abc.jpg`);
  });
  it("ignores everything else", () => {
    expect(communityMediaObjectPath(null, cid, "icon")).toBeNull();
    expect(communityMediaObjectPath(`${base}${cid}/cover/abc.png`, cid, "icon")).toBeNull();
    expect(communityMediaObjectPath(`${base}${other}/icon/abc.png`, cid, "icon")).toBeNull();
    expect(communityMediaObjectPath(`${base}${cid}/icon/deep/abc.png`, cid, "icon")).toBeNull();
    expect(communityMediaObjectPath(`${base}${cid}/abc.png`, cid, "icon")).toBeNull();
    expect(communityMediaObjectPath(`https://proj.supabase.co/storage/v1/object/public/avatars/${cid}/icon/abc.png`, cid, "icon")).toBeNull();
  });
});

describe("communityFallback", () => {
  it("uses the emoji icon, else the first letter", () => {
    expect(communityFallback({ icon: "⚡", name: "OpenCtrl" })).toBe("⚡");
    expect(communityFallback({ icon: "", name: "openctrl" })).toBe("O");
    expect(communityFallback({ icon: "  ", name: " x" })).toBe("X");
  });
});

describe("shared image helpers", () => {
  it("name the size limit they were given", () => {
    expect(imageFileProblem({ type: "image/png", size: 1024 * 1024 + 1 }, 1024 * 1024)).toBe("That image is over 1 MB.");
    expect(imageFileProblem({ type: "image/png", size: 3 * 1024 * 1024 }, 2.5 * 1024 * 1024)).toMatch(/2\.5 MB/);
  });
  it("never return a path for dot segments or bad encoding", () => {
    expect(publicObjectPath(`${base}${cid}/icon/..`, "community-media", `${cid}/icon`)).toBeNull();
    expect(publicObjectPath(`${base}${cid}/icon/%2e%2e`, "community-media", `${cid}/icon`)).toBeNull();
    expect(publicObjectPath(`${base}${cid}/icon/%E0%A4%A`, "community-media", `${cid}/icon`)).toBeNull();
    expect(publicObjectPath(`${base}${cid}/icon/a%2Fb.png`, "community-media", `${cid}/icon`)).toBeNull();
  });
});
