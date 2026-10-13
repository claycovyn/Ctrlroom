import { describe, expect, it } from "vitest";
import { approvedEmail } from "@/lib/joinRequests";

describe("approvedEmail", () => {
  it("names the community and links to it", () => {
    const { subject, text } = approvedEmail("Night Owls", "https://ctrlroom.example/c/night-owls");
    expect(subject).toBe("You're in Night Owls");
    expect(text).toContain("approved your request to join Night Owls");
    expect(text).toContain("https://ctrlroom.example/c/night-owls");
  });
});
