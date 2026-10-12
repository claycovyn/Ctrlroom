import { describe, expect, it, vi } from "vitest";
import { cleanAnswer, clip, decodeEntities, htmlToText } from "@/lib/agent/text";

vi.mock("server-only", () => ({}));
const { isPrivateAddress } = await import("@/lib/agent/safeFetch");

describe("htmlToText", () => {
  it("keeps readable text and drops scripts, styles and nav", () => {
    const { title, text } = htmlToText(
      `<html><head><title>Hello &amp; welcome</title><style>p{}</style></head><body><nav>Menu</nav><h1>Big</h1><p>One&nbsp;two</p><script>alert(1)</script><ul><li>a</li><li>b</li></ul></body></html>`,
    );
    expect(title).toBe("Hello & welcome");
    expect(text).toBe("Big\nOne two\n- a\n- b");
  });
  it("decodes numeric entities", () => {
    expect(decodeEntities("&#39;x&#x27; &copy;")).toBe("'x' &copy;");
  });
});

describe("cleanAnswer", () => {
  it("removes hidden reasoning and markdown the chat can't show", () => {
    expect(cleanAnswer("<think>hmm</think>## Title\n**Bold** see [docs](https://x.dev/a)\n\n\n\nend")).toBe("Title\nBold see docs (https://x.dev/a)\n\nend");
  });
  it("clips long text", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});
