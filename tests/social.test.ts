import { describe, expect, it } from "vitest";
import { charsLeft, countLabel, isFeedScope, mergePosts, shortAge, toggledLike, type PostCard } from "@/lib/social";

const post = (id: string, over: Partial<PostCard> = {}): PostCard => ({
  id, author_id: "a", community_id: null, reply_to: null, body: "hi", created_at: "2026-10-15T12:00:00Z", edited_at: null,
  author_username: "ann", author_name: "Ann", author_avatar: null, author_is_bot: false, community_slug: null,
  community_name: null, community_icon: null, like_count: 0, reply_count: 0, liked: false, media: [], ...over,
});

describe("posts", () => {
  it("shows short ages", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(shortAge("2026-10-15T11:59:30Z", now)).toBe("now");
    expect(shortAge("2026-10-15T11:55:00Z", now)).toBe("5m");
    expect(shortAge("2026-10-15T09:00:00Z", now)).toBe("3h");
    expect(shortAge("2026-10-13T12:00:00Z", now)).toBe("2d");
    expect(shortAge("2026-09-01T12:00:00Z", now)).toBe("Sep 1");
    expect(shortAge("2025-09-01T12:00:00Z", now)).toBe("Sep 1, 2025");
    expect(shortAge("nonsense", now)).toBe("");
  });
  it("counts and limits", () => {
    expect(countLabel(1, "follower", "followers")).toBe("1 follower");
    expect(countLabel(2300, "follower", "followers")).toBe("2,300 followers");
    expect(charsLeft("  hello  ")).toBe(495);
    expect(isFeedScope("everyone")).toBe(true);
    expect(isFeedScope("for-you")).toBe(false);
  });
  it("likes at once, and pages without duplicates", () => {
    expect(toggledLike(post("1"))).toMatchObject({ liked: true, like_count: 1 });
    expect(toggledLike(post("1", { liked: true, like_count: 1 }))).toMatchObject({ liked: false, like_count: 0 });
    expect(toggledLike(post("1", { liked: true, like_count: 0 })).like_count).toBe(0);
    expect(mergePosts([post("1"), post("2")], [post("2"), post("3")]).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
});
