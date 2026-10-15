import { describe, expect, it, vi } from "vitest";
import {
  DM_PREFIX,
  inviteDm,
  OPENCTRL_BOT_ID,
  RESEND_AFTER_MS,
  runShiftInvites,
  SHIFT_HEADERS,
  shiftClient,
  signShift,
  type InviteStore,
  type Reactor,
  type ShiftAnswer,
} from "@/lib/shiftInvites";

vi.mock("server-only", () => ({}));
const { supabaseInviteStore } = await import("@/lib/shiftInviteStore");

const NOW = Date.parse("2026-10-14T12:00:00Z");
const URL_OF = (code: string) => `https://shift.example/i/${code}`;

// ── A mocked Ctrl Room (the InviteStore the run talks to) and a mocked Shift ──────────────────────────────────────────

interface Person extends Reactor {
  confirmed: boolean;
}
const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, isBot: false, member: true, banned: false, whoCanDm: "shared_community", blocked: false, confirmed: true, ...extra });

function fakeRoom(people: Person[], o: { message?: string | null; reactions?: string[]; failDm?: (id: string) => boolean } = {}) {
  const dms: { to: string; body: string }[] = [];
  const store: InviteStore = {
    inviteMessage: async () => (o.message === undefined ? "msg-1" : o.message),
    reactorIds: async () => [...new Set(o.reactions ?? people.map((p) => p.id))],
    deliveredTo: async () => new Set(dms.filter((d) => d.body.startsWith(DM_PREFIX)).map((d) => d.to)),
    reactors: async (ids) => people.filter((p) => ids.includes(p.id)),
    emailConfirmed: async (id) => people.find((p) => p.id === id)?.confirmed ?? false,
    sendDm: async (to, body) => {
      if (o.failDm?.(to)) throw new Error("CR: You're sending messages very fast.");
      dms.push({ to, body });
    },
  };
  return { store, dms, people };
}

/** Shift: one code per id; `capAfter` new codes, then 429. */
function fakeShift(o: { capAfter?: number; closed?: boolean; issuedAt?: (id: string) => number; used?: Set<string> } = {}) {
  const codes = new Map<string, { code: string; at: number }>();
  const asked: string[] = [];
  const shift = vi.fn(async (id: string): Promise<ShiftAnswer> => {
    asked.push(id);
    if (o.closed) return { kind: "closed" };
    const had = codes.get(id);
    if (had) return { kind: "ok", code: had.code, url: URL_OF(had.code), fresh: false, used: o.used?.has(id) ?? false, issuedAt: new Date(had.at).toISOString() };
    if (o.capAfter !== undefined && codes.size >= o.capAfter) return { kind: "capped", retryAfter: 3600 };
    const code = `CODE${codes.size + 1}`;
    codes.set(id, { code, at: o.issuedAt?.(id) ?? NOW });
    return { kind: "ok", code, url: URL_OF(code), fresh: true, used: false, issuedAt: new Date(codes.get(id)!.at).toISOString() };
  });
  return { shift, asked, codes };
}

describe("the DM", () => {
  it("is plain and says what the link does", () => {
    expect(inviteDm("https://shift.openctrl.app/i/ABCDEFGHJK")).toBe(
      "Here's your invite to OpenCtrl Shift: https://shift.openctrl.app/i/ABCDEFGHJK. It works once. Once you're in, you'll get five of your own to share.",
    );
  });
});

describe("runShiftInvites", () => {
  it("sends an invite to each person who reacted and qualifies, once", async () => {
    const room = fakeRoom([person("ada"), person("bo")]);
    const s = fakeShift();
    const r = await runShiftInvites(room.store, s.shift, { now: () => NOW });
    expect(r).toMatchObject({ message: "msg-1", reactors: 2, asked: 2, sent: 2, resent: 0, failed: 0, stopped: null });
    expect(room.dms).toEqual([
      { to: "ada", body: inviteDm(URL_OF("CODE1")) },
      { to: "bo", body: inviteDm(URL_OF("CODE2")) },
    ]);
    // The next run sees the DMs and doesn't ask Shift again.
    const again = await runShiftInvites(room.store, s.shift, { now: () => NOW + 5 * 60_000 });
    expect(again).toMatchObject({ alreadySent: 2, asked: 0, sent: 0 });
    expect(s.asked).toEqual(["ada", "bo"]);
  });

  it("leaves out bots, non-members, banned people and unconfirmed emails, without asking Shift", async () => {
    const room = fakeRoom([
      person(OPENCTRL_BOT_ID, { isBot: true }),
      person("ctrl-bot", { isBot: true }),
      person("visitor", { member: false }),
      person("banned", { banned: true }),
      person("unconfirmed", { confirmed: false }),
      person("ok"),
    ], { reactions: [OPENCTRL_BOT_ID, "ctrl-bot", "visitor", "banned", "unconfirmed", "ghost", "ok"] });
    const s = fakeShift();
    const r = await runShiftInvites(room.store, s.shift, { now: () => NOW });
    expect(s.asked).toEqual(["ok"]);
    expect(room.dms.map((d) => d.to)).toEqual(["ok"]);
    expect(r.skipped).toEqual({ bot: 2, not_member: 2, banned: 1, unconfirmed: 1 });
  });

  it("only DMs a fresh code: a code issued moments ago by another run is left alone", async () => {
    const room = fakeRoom([person("ada")]);
    const s = fakeShift();
    s.codes.set("ada", { code: "EARLIER", at: NOW - 30_000 }); // another run got fresh: true and is sending it
    const r = await runShiftInvites(room.store, s.shift, { now: () => NOW });
    expect(r).toMatchObject({ asked: 1, sent: 0, resent: 0 });
    expect(room.dms).toEqual([]);
  });

  it("sends again a code that was issued but never delivered (the DM failed), after a while", async () => {
    let failing = true;
    const room = fakeRoom([person("ada")], { failDm: () => failing });
    const s = fakeShift();
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW })).toMatchObject({ sent: 0, failed: 1 });
    failing = false;
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW + 5 * 60_000 })).toMatchObject({ sent: 0, resent: 0 });
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW + RESEND_AFTER_MS })).toMatchObject({ resent: 1 });
    expect(room.dms).toEqual([{ to: "ada", body: inviteDm(URL_OF("CODE1")) }]);
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW + 2 * RESEND_AFTER_MS })).toMatchObject({ alreadySent: 1, asked: 0 });
  });

  it("doesn't send a code that has already been used", async () => {
    const room = fakeRoom([person("ada")]);
    const s = fakeShift({ used: new Set(["ada"]) });
    s.codes.set("ada", { code: "USED", at: NOW - 3_600_000 });
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW })).toMatchObject({ asked: 1, sent: 0, resent: 0 });
    expect(room.dms).toEqual([]);
  });

  it("stops at Shift's 429; the next run carries on", async () => {
    const room = fakeRoom([person("a"), person("b"), person("c")]);
    const s = fakeShift({ capAfter: 1 });
    const r = await runShiftInvites(room.store, s.shift, { now: () => NOW });
    expect(r).toMatchObject({ sent: 1, stopped: "capped", retryAfter: 3600 });
    expect(s.asked).toEqual(["a", "b"]); // c is never asked in this run
    expect(room.dms.map((d) => d.to)).toEqual(["a"]);
  });

  it("stops when Shift is open to everyone (410), and on a Shift error", async () => {
    const room = fakeRoom([person("a"), person("b")]);
    const closed = fakeShift({ closed: true });
    expect(await runShiftInvites(room.store, closed.shift, { now: () => NOW })).toMatchObject({ stopped: "closed", sent: 0 });
    expect(closed.asked).toEqual(["a"]);
    const broken = vi.fn(async (): Promise<ShiftAnswer> => ({ kind: "error", status: 500 }));
    expect(await runShiftInvites(room.store, broken, { now: () => NOW })).toMatchObject({ stopped: "shift_error", sent: 0 });
    expect(broken).toHaveBeenCalledTimes(1);
    expect(room.dms).toEqual([]);
  });

  it("skips people whose DMs are off or who blocked OpenCtrl, records nothing, and picks them up after they change it", async () => {
    const people = [person("quiet", { whoCanDm: "nobody" }), person("blocker", { blocked: true }), person("open", { whoCanDm: "anyone" }), person("default")];
    const room = fakeRoom(people);
    const s = fakeShift();
    const r = await runShiftInvites(room.store, s.shift, { now: () => NOW });
    expect(r.skipped).toEqual({ dm_off: 1, blocked: 1 });
    expect(s.asked).toEqual(["open", "default"]);
    expect(room.dms.map((d) => d.to)).toEqual(["open", "default"]);
    people[0].whoCanDm = "shared_community";
    await runShiftInvites(room.store, s.shift, { now: () => NOW + 5 * 60_000 });
    expect(room.dms.map((d) => d.to)).toEqual(["open", "default", "quiet"]);
    expect(room.dms[2].body).toBe(inviteDm(URL_OF("CODE3")));
  });

  it("caps DMs per run and leaves the rest to the next run", async () => {
    const room = fakeRoom(Array.from({ length: 5 }, (_, i) => person(`p${i}`)));
    const s = fakeShift();
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW, maxDms: 2 })).toMatchObject({ sent: 2, stopped: "limit" });
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW, maxDms: 2 })).toMatchObject({ alreadySent: 2, sent: 2 });
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW, maxDms: 2 })).toMatchObject({ alreadySent: 4, sent: 1, stopped: null });
  });

  it("does nothing without a pinned post", async () => {
    const room = fakeRoom([person("a")], { message: null });
    const s = fakeShift();
    expect(await runShiftInvites(room.store, s.shift, { now: () => NOW })).toMatchObject({ message: null, asked: 0 });
    expect(s.shift).not.toHaveBeenCalled();
  });
});

// ── The signed call ───────────────────────────────────────────────────────────────────────────────────────────────

describe("shiftClient", () => {
  const SECRET = "test-secret-0123456789abcdef0123456789";

  it("signs like Shift checks (the same test vector as Shift's tests/server/ctrlroom.test.ts)", () => {
    const body = JSON.stringify({ externalId: "11111111-1111-4111-8111-111111111111", source: "ctrlroom" });
    expect(signShift(SECRET, "1760400000", "nonce_0123456789ab", body)).toBe("v1=7eccd9327c532913c2b282467e77bf53972b822b0096116b49840b0d5ef55e7f");
  });

  it("sends the id with a fresh nonce and a signature over timestamp, nonce and body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return Response.json({ code: "ABCDEFGHJK", url: URL_OF("ABCDEFGHJK"), fresh: true, used: false, issuedAt: new Date(NOW).toISOString() });
    });
    const client = shiftClient({ url: "https://shift.example/api/invites/issue", secret: SECRET, fetch: f as typeof fetch, now: () => NOW });
    expect(await client("u-1")).toEqual({ kind: "ok", code: "ABCDEFGHJK", url: URL_OF("ABCDEFGHJK"), fresh: true, used: false, issuedAt: new Date(NOW).toISOString() });
    await client("u-1");
    const h = (i: number) => calls[i].init.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://shift.example/api/invites/issue");
    expect(calls[0].init.body).toBe('{"externalId":"u-1","source":"ctrlroom"}');
    expect(h(0)[SHIFT_HEADERS.timestamp]).toBe(String(NOW / 1000));
    expect(h(0)[SHIFT_HEADERS.signature]).toBe(signShift(SECRET, h(0)[SHIFT_HEADERS.timestamp], h(0)[SHIFT_HEADERS.nonce], String(calls[0].init.body)));
    expect(h(0)[SHIFT_HEADERS.nonce]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(h(1)[SHIFT_HEADERS.nonce]).not.toBe(h(0)[SHIFT_HEADERS.nonce]);
  });

  it("reads 429, 410, errors and unreachable", async () => {
    const answer = (res: Response | Error) => shiftClient({ url: "https://shift.example/x", secret: SECRET, fetch: (async () => { if (res instanceof Error) throw res; return res; }) as typeof fetch });
    expect(await answer(Response.json({ retryAfter: 120 }, { status: 429 }))("u")).toEqual({ kind: "capped", retryAfter: 120 });
    expect(await answer(Response.json({ open: true }, { status: 410 }))("u")).toEqual({ kind: "closed" });
    expect(await answer(Response.json({ error: "Bad signature." }, { status: 401 }))("u")).toEqual({ kind: "error", status: 401 });
    expect(await answer(Response.json({ code: "X", url: "javascript:alert(1)" }))("u")).toEqual({ kind: "error", status: 200 });
    expect(await answer(new Error("offline"))("u")).toEqual({ kind: "error", status: 0 });
  });
});

// ── The Supabase side, against a mocked Supabase client ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Just enough of supabase-js's query builder for supabaseInviteStore, over in-memory tables. */
function fakeSupabase(tables: Record<string, Row[]>, users: Record<string, { email: string; email_confirmed_at: string | null }>) {
  let ids = 0;
  class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
    private filters: ((r: Row) => boolean)[] = [];
    private sorts: { col: string; asc: boolean }[] = [];
    private lim = Infinity;
    private from = 0;
    private one: "single" | "maybe" | null = null;
    private cols = "*";
    private write: { kind: "insert" | "upsert"; rows: Row[]; onConflict?: string } | null = null;
    constructor(private table: string) {}
    select(cols = "*") {
      this.cols = cols;
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    not(c: string, _op: "is", _v: null) {
      this.filters.push((r) => r[c] != null);
      return this;
    }
    like(c: string, p: string) {
      this.filters.push((r) => String(r[c] ?? "").startsWith(p.replace(/%$/, "")));
      return this;
    }
    or(s: string) {
      const parts = s.split(",").map((x) => x.split(".eq."));
      this.filters.push((r) => parts.some(([c, v]) => r[c] === v));
      return this;
    }
    order(col: string, o: { ascending?: boolean } = {}) {
      this.sorts.push({ col, asc: o.ascending !== false });
      return this;
    }
    limit(n: number) {
      this.lim = n;
      return this;
    }
    range(a: number, b: number) {
      this.from = a;
      this.lim = b - a + 1;
      return this;
    }
    maybeSingle() {
      this.one = "maybe";
      return this;
    }
    single() {
      this.one = "single";
      return this;
    }
    insert(row: Row) {
      this.write = { kind: "insert", rows: [row] };
      return this;
    }
    upsert(rows: Row[], o: { onConflict: string }) {
      this.write = { kind: "upsert", rows, onConflict: o.onConflict };
      return this;
    }
    private run(): { data: unknown; error: { message: string; code?: string } | null } {
      const t = (tables[this.table] ??= []);
      if (this.write?.kind === "insert") {
        const row: Row = { id: `id-${++ids}`, created_at: new Date(NOW + ids).toISOString(), ...this.write.rows[0] };
        if (this.table === "dm_conversations" && t.some((x) => x.pair_key === row.pair_key)) return { data: null, error: { message: "duplicate", code: "23505" } };
        t.push(row);
        return { data: row, error: null };
      }
      if (this.write?.kind === "upsert") {
        const keys = this.write.onConflict!.split(",");
        for (const row of this.write.rows) {
          const had = t.find((x) => keys.every((k) => x[k] === row[k]));
          if (had) Object.assign(had, row);
          else t.push({ ...row });
        }
        return { data: null, error: null };
      }
      let rows = t.filter((r) => this.filters.every((f) => f(r)));
      for (const s of [...this.sorts].reverse()) rows = [...rows].sort((a, b) => (String(a[s.col]) < String(b[s.col]) ? -1 : String(a[s.col]) > String(b[s.col]) ? 1 : 0) * (s.asc ? 1 : -1));
      rows = rows.slice(this.from, this.from + this.lim);
      if (this.cols.includes("dm_conversations!inner")) {
        rows = rows.map((r) => ({ ...r, dm_conversations: { pair_key: tables.dm_conversations.find((c) => c.id === r.conversation_id)?.pair_key ?? null } }));
      }
      if (this.one) return rows.length > 1 ? { data: null, error: { message: "more than one row" } } : { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    then<A, B>(ok?: (v: { data: unknown; error: { message: string; code?: string } | null }) => A | PromiseLike<A>, bad?: (e: unknown) => B | PromiseLike<B>) {
      return Promise.resolve(this.run()).then(ok, bad);
    }
  }
  return {
    from: (t: string) => new Query(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ?? null }, error: users[id] ? null : { message: "not found" } }) } },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function seed() {
  return {
    communities: [{ id: "c-oc", slug: "openctrl" }, { id: "c-other", slug: "other" }],
    rooms: [{ id: "r-wait", community_id: "c-oc", slug: "waitlist" }],
    community_members: [
      { community_id: "c-oc", user_id: "owner", role: "owner" },
      { community_id: "c-oc", user_id: "ada", role: "member" },
      { community_id: "c-oc", user_id: "bo", role: "member" },
      { community_id: "c-oc", user_id: "cy", role: "member" },
    ],
    messages: [
      { id: "m-invite", community_id: "c-oc", deleted_at: null },
      { id: "m-old", community_id: "c-oc", deleted_at: null },
      { id: "m-gone", community_id: "c-oc", deleted_at: "2026-10-13T00:00:00Z" },
      { id: "m-member", community_id: "c-oc", deleted_at: null },
      { id: "m-elsewhere", community_id: "c-other", deleted_at: null },
    ],
    board_items: [
      { room_id: "r-wait", message_id: "m-old", created_by: "owner", created_at: "2026-10-01T00:00:00Z" },
      { room_id: "r-wait", message_id: "m-invite", created_by: "owner", created_at: "2026-10-10T00:00:00Z" },
      { room_id: "r-wait", message_id: "m-gone", created_by: "owner", created_at: "2026-10-12T00:00:00Z" },
      { room_id: "r-wait", message_id: "m-member", created_by: "ada", created_at: "2026-10-13T00:00:00Z" },
      { room_id: "r-wait", message_id: null, created_by: "owner", created_at: "2026-10-14T00:00:00Z" },
    ],
    reactions: [
      { message_id: "m-invite", user_id: "bo", emoji: "👍", created_at: "2026-10-14T09:00:00Z" },
      { message_id: "m-invite", user_id: "ada", emoji: "🎉", created_at: "2026-10-14T09:01:00Z" },
      { message_id: "m-invite", user_id: "bo", emoji: "🎉", created_at: "2026-10-14T09:02:00Z" },
      { message_id: "m-invite", user_id: OPENCTRL_BOT_ID, emoji: "👍", created_at: "2026-10-14T09:03:00Z" },
      { message_id: "m-old", user_id: "cy", emoji: "👍", created_at: "2026-10-14T09:04:00Z" },
    ],
    profiles: [{ id: "ada", is_bot: false }, { id: "bo", is_bot: false }, { id: "cy", is_bot: false }, { id: "zed", is_bot: false }, { id: OPENCTRL_BOT_ID, is_bot: true }],
    bans: [{ community_id: "c-oc", user_id: "cy" }],
    dm_settings: [{ user_id: "bo", who_can_dm: "nobody" }],
    blocks: [] as Row[],
    dm_conversations: [] as Row[],
    dm_members: [] as Row[],
    dm_messages: [] as Row[],
  };
}
const USERS = { ada: { email: "ada@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" }, bo: { email: "bo@example.com", email_confirmed_at: null } };

describe("supabaseInviteStore (mocked Supabase)", () => {
  it("finds the newest live post a mod pinned in #waitlist; other people's pins don't count", async () => {
    const t = seed();
    expect(await supabaseInviteStore(fakeSupabase(t, USERS)).inviteMessage()).toBe("m-invite");
    t.messages[0].deleted_at = "2026-10-14T00:00:00Z";
    expect(await supabaseInviteStore(fakeSupabase(t, USERS)).inviteMessage()).toBe("m-old");
    t.board_items = [];
    expect(await supabaseInviteStore(fakeSupabase(t, USERS)).inviteMessage()).toBeNull();
  });

  it("uses CTRLROOM_SHIFT_INVITE_MESSAGE_ID instead, only for a live message in the community", async () => {
    const t = seed();
    expect(await supabaseInviteStore(fakeSupabase(t, USERS), { messageId: "m-member" }).inviteMessage()).toBe("m-member");
    expect(await supabaseInviteStore(fakeSupabase(t, USERS), { messageId: "m-elsewhere" }).inviteMessage()).toBeNull();
    expect(await supabaseInviteStore(fakeSupabase(t, USERS), { messageId: "m-gone" }).inviteMessage()).toBeNull();
  });

  it("lists each reacting person once, by first reaction, with what decides whether they qualify", async () => {
    const store = supabaseInviteStore(fakeSupabase(seed(), USERS));
    expect(await store.reactorIds("m-invite")).toEqual(["bo", "ada", OPENCTRL_BOT_ID]);
    expect(await store.reactors(["ada", "bo", "cy", "zed", OPENCTRL_BOT_ID])).toEqual([
      { id: "ada", isBot: false, member: true, banned: false, whoCanDm: "shared_community", blocked: false },
      { id: "bo", isBot: false, member: true, banned: false, whoCanDm: "nobody", blocked: false },
      { id: "cy", isBot: false, member: true, banned: true, whoCanDm: "shared_community", blocked: false },
      { id: "zed", isBot: false, member: false, banned: false, whoCanDm: "shared_community", blocked: false },
      { id: OPENCTRL_BOT_ID, isBot: true, member: false, banned: false, whoCanDm: "shared_community", blocked: false },
    ]);
    expect(await store.emailConfirmed("ada")).toBe(true);
    expect(await store.emailConfirmed("bo")).toBe(false);
    expect(await store.emailConfirmed("nobody")).toBe(false);
  });

  it("DMs from the OpenCtrl account in one 1:1 per person, and knows who already has an invite DM", async () => {
    const t = seed();
    const store = supabaseInviteStore(fakeSupabase(t, USERS));
    await store.sendDm("ada", inviteDm(URL_OF("A")));
    await store.sendDm("ada", "Something else");
    await store.sendDm("bo", inviteDm(URL_OF("B")));
    expect(t.dm_conversations.map((c) => c.pair_key)).toEqual([[OPENCTRL_BOT_ID, "ada"].sort().join(":"), [OPENCTRL_BOT_ID, "bo"].sort().join(":")]);
    expect(t.dm_members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversation_id: t.dm_conversations[0].id, user_id: "ada", status: "active" }),
        expect.objectContaining({ conversation_id: t.dm_conversations[0].id, user_id: OPENCTRL_BOT_ID, status: "active" }),
      ]),
    );
    expect(t.dm_members).toHaveLength(4);
    expect(t.dm_messages.map((m) => [m.author_id, m.body])).toEqual([
      [OPENCTRL_BOT_ID, inviteDm(URL_OF("A"))],
      [OPENCTRL_BOT_ID, "Something else"],
      [OPENCTRL_BOT_ID, inviteDm(URL_OF("B"))],
    ]);
    expect([...(await store.deliveredTo())].sort()).toEqual(["ada", "bo"]);
  });

  it("runs end to end: the right people get the DM, once", async () => {
    const t = seed();
    const db = fakeSupabase(t, USERS);
    const s = fakeShift();
    const first = await runShiftInvites(supabaseInviteStore(db), s.shift, { now: () => NOW });
    expect(first).toMatchObject({ message: "m-invite", reactors: 3, sent: 1, skipped: { dm_off: 1, bot: 1 } });
    expect(s.asked).toEqual(["ada"]);
    expect(t.dm_messages.map((m) => m.body)).toEqual([inviteDm(URL_OF("CODE1"))]);
    expect(await runShiftInvites(supabaseInviteStore(db), s.shift, { now: () => NOW + 300_000 })).toMatchObject({ alreadySent: 1, asked: 0 });
  });
});
