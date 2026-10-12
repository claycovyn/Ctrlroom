import { describe, expect, it } from "vitest";
import { avatarFileProblem, avatarObjectPath, avatarPath } from "@/lib/avatar";

const uid = "40000000-0000-0000-0000-00000000000a";

describe("avatarFileProblem", () => {
  it("accepts small png, jpeg and webp", () => {
    expect(avatarFileProblem({ type: "image/png", size: 2000 })).toBeNull();
    expect(avatarFileProblem({ type: "image/jpeg", size: 1024 * 1024 })).toBeNull();
    expect(avatarFileProblem({ type: "image/webp", size: 1 })).toBeNull();
  });
  it("refuses other types, big and empty files", () => {
    expect(avatarFileProblem({ type: "image/gif", size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(avatarFileProblem({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(avatarFileProblem({ type: "image/png", size: 1024 * 1024 + 1 })).toMatch(/1 MB/);
    expect(avatarFileProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
  });
});

describe("avatarPath", () => {
  it("puts the file in the user's folder with the right extension", () => {
    expect(avatarPath(uid, "image/jpeg", "abc")).toBe(`${uid}/abc.jpg`);
    expect(avatarPath(uid, "image/webp", "abc")).toBe(`${uid}/abc.webp`);
  });
});

describe("avatarObjectPath", () => {
  const base = "https://proj.supabase.co/storage/v1/object/public/avatars/";
  it("finds the object for a photo in your own folder", () => {
    expect(avatarObjectPath(`${base}${uid}/abc.png`, uid)).toBe(`${uid}/abc.png`);
    expect(avatarObjectPath(`${base}${uid}/abc.png?v=2`, uid)).toBe(`${uid}/abc.png`);
  });
  it("ignores everything else", () => {
    expect(avatarObjectPath(null, uid)).toBeNull();
    expect(avatarObjectPath("/brand/ctrlroom-icon-192.png", uid)).toBeNull();
    expect(avatarObjectPath(`${base}someone-else/abc.png`, uid)).toBeNull();
    expect(avatarObjectPath(`${base}${uid}/nested/abc.png`, uid)).toBeNull();
  });
});
