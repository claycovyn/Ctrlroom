// Opening a conversation must really mark it read on the server. Supabase queries are lazy (they only send once
// awaited or then'd), so a bare `.rpc(...)` never ran and DMs stayed unread after you opened them.
import { afterEach, describe, expect, it, vi } from "vitest";

let sent: { fn: string; args: unknown }[] = [];
let result: { error: unknown } = { error: null };
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    // A lazy thenable like supabase-js: nothing is "sent" until then() is called.
    rpc: (fn: string, args: unknown) => ({
      then: (ok: (v: { error: unknown }) => unknown, bad?: (e: unknown) => unknown) => {
        sent.push({ fn, args });
        return Promise.resolve(result).then(ok, bad);
      },
    }),
  }),
}));
vi.mock("@/components/chat/PresenceContext", () => ({ usePresence: () => null }));

const { markDmRead } = await import("@/components/dm/DmContext");
const { DM_READ_EVENT } = await import("@/lib/shell");

afterEach(() => {
  sent = [];
  result = { error: null };
  vi.unstubAllGlobals();
});

describe("markDmRead", () => {
  it("sends mark_dm_read and tells the shell to refresh the Messages badge", async () => {
    const events: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
    await markDmRead("c1");
    expect(sent).toEqual([{ fn: "mark_dm_read", args: { p_conv: "c1" } }]);
    expect(events).toEqual([DM_READ_EVENT]);
  });

  it("doesn't refresh the badge when the server refused", async () => {
    const events: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
    result = { error: { message: "nope" } };
    await markDmRead("c1");
    expect(sent).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
