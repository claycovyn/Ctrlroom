/* eslint-disable @typescript-eslint/no-explicit-any */
// QA harness: an in-memory stand-in for the browser Supabase client (src/lib/supabase/client.ts). Chainable queries
// over window.__db (seeded by ../data.ts), a few RPCs, Storage signed URLs, and Realtime channels that the Playwright
// scripts drive through window.__sim (broadcast events, presence). Every query answers after window.__lat ms.

type Row = Record<string, any>;
type Cb = (...a: any[]) => void;
interface Db {
  tables: Record<string, Row[]>;
  rpc: Record<string, (args: any) => any>;
}
const W = window as unknown as { __db: Db; __lat?: number; __sim: any; __peers: Record<string, any[]>; __sent: any[]; __queries: number };
W.__sent = [];
W.__queries = 0;

let seq = 0;
export const uuid = () => {
  seq += 1;
  return `f0000000-0000-4000-8000-${String(Date.now() % 1e6).padStart(6, "0")}${String(seq).padStart(6, "0")}`;
};

const later = <T,>(v: T): Promise<T> => new Promise((ok) => setTimeout(() => ok(v), W.__lat ?? 40));

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let lim = Infinity;
  let from = 0;
  let one: "single" | "maybe" | null = null;
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: any = null;
  let head = false;
  let count = false;
  const q: any = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) head = true;
      if (opts?.count) count = true;
      return q;
    },
    eq: (c: string, v: any) => (c.includes(".") || filters.push((r) => r[c] === v), q),
    neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
    is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
    in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), q),
    lt: (c: string, v: any) => (filters.push((r) => r[c] < v), q),
    lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), q),
    gt: (c: string, v: any) => (filters.push((r) => r[c] > v), q),
    gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
    ilike: (c: string, v: string) => {
      if (c.includes(".")) return q;
      const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
      filters.push((r) => re.test(String(r[c] ?? "")));
      return q;
    },
    match: (o: Row) => (Object.entries(o).forEach(([k, v]) => filters.push((r) => r[k] === v)), q),
    order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((lim = n), q),
    range: (a: number, b: number) => ((from = a), (lim = b - a + 1), q),
    single: () => ((one = "single"), q),
    maybeSingle: () => ((one = "maybe"), q),
    insert: (rows: any) => ((op = "insert"), (payload = rows), q),
    upsert: (rows: any) => ((op = "upsert"), (payload = rows), q),
    update: (patch: any) => ((op = "update"), (payload = patch), q),
    delete: () => ((op = "delete"), q),
    then(res: (v: any) => any, rej?: (e: any) => any) {
      return later(run()).then(res, rej);
    },
  };
  const run = () => {
    W.__queries += 1;
    const t = (W.__db.tables[table] ??= []);
    let out: Row[];
    if (op === "insert" || op === "upsert") {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => defaults(table, r));
      for (const r of list) {
        const i = op === "upsert" ? t.findIndex((x) => x.id === r.id) : -1;
        if (i >= 0) t[i] = { ...t[i], ...r };
        else t.push(r);
      }
      out = list;
    } else {
      out = t.filter((r) => filters.every((f) => f(r)));
      if (op === "update") out.forEach((r) => Object.assign(r, payload));
      if (op === "delete") W.__db.tables[table] = t.filter((r) => !out.includes(r));
    }
    for (const { col, asc } of [...orders].reverse()) {
      out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    const total = out.length;
    out = out.slice(from, from + lim);
    if (head) return { data: null, error: null, count: total };
    if (one) {
      if (!out[0] && one === "single") return { data: null, error: { message: "not found", code: "PGRST116" } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null, count: count ? total : null };
  };
  return q;
}

function defaults(table: string, r: Row): Row {
  const now = new Date().toISOString();
  if (table === "messages") {
    return {
      id: uuid(), community_id: "", parent_id: null, reply_count: 0, last_reply_at: null, resolved_at: null, resolved_by: null,
      outcome: null, edited_at: null, deleted_at: null, attachments: [], created_at: now, ...r,
    };
  }
  if (table === "dm_messages") return { id: uuid(), edited_at: null, deleted_at: null, attachments: [], created_at: now, ...r };
  return { id: r.id ?? uuid(), created_at: now, ...r };
}

// ── realtime
interface Ch {
  topic: string;
  handlers: { type: string; event: string; cb: Cb }[];
  on(type: string, filter: { event: string }, cb: Cb): Ch;
  subscribe(cb?: Cb): Ch;
  presenceState(): Record<string, any[]>;
  track(p: any): Promise<string>;
  untrack(): Promise<string>;
  send(m: any): Promise<string>;
}
const live = new Set<Ch>();
let tracked: any = null;
const presenceSync = () => live.forEach((c) => c.handlers.filter((h) => h.type === "presence" && h.event === "sync").forEach((h) => h.cb()));

W.__sim = {
  /** Broadcast an event to every subscriber of a topic (what Postgres triggers do through realtime.send). */
  emit(topic: string, event: string, payload: any) {
    live.forEach((c) => c.topic === topic && c.handlers.filter((h) => h.type === "broadcast" && h.event === event).forEach((h) => h.cb({ payload })));
  },
  /** Replace everyone else's presence and fire a sync. */
  setPeers(peers: Record<string, any[]>) {
    W.__peers = peers;
    presenceSync();
  },
  topics: () => [...live].map((c) => c.topic),
};

const client = {
  realtime: { setAuth: async () => {} },
  channel(topic: string) {
    const ch: Ch = {
      topic,
      handlers: [],
      on(type, filter, cb) {
        ch.handlers.push({ type, event: filter.event, cb });
        return ch;
      },
      subscribe(cb) {
        live.add(ch);
        setTimeout(() => {
          cb?.("SUBSCRIBED");
          if (topic.startsWith("presence:")) presenceSync();
        }, 20);
        return ch;
      },
      presenceState() {
        const s: Record<string, any[]> = { ...(W.__peers ?? {}) };
        if (tracked) s[tracked.user_id] = [tracked];
        return s;
      },
      track(p) {
        tracked = p;
        setTimeout(presenceSync, 10);
        return Promise.resolve("ok");
      },
      untrack() {
        tracked = null;
        setTimeout(presenceSync, 10);
        return Promise.resolve("ok");
      },
      send(m) {
        W.__sent.push({ topic, ...m });
        return Promise.resolve("ok");
      },
    };
    return ch;
  },
  removeChannel(ch: Ch) {
    live.delete(ch);
    return Promise.resolve("ok");
  },
  from: (t: string) => query(t),
  rpc: (name: string, args?: any) => {
    const fn = W.__db.rpc[name];
    const thenable = {
      then(res: (v: any) => any, rej?: (e: any) => any) {
        W.__queries += 1;
        return later(fn ? { data: fn(args ?? {}), error: null } : { data: null, error: null }).then(res, rej);
      },
    };
    return thenable;
  },
  auth: {
    getUser: async () => ({ data: { user: null } }),
    getSession: async () => ({ data: { session: { access_token: "t" } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    resend: async () => ({ error: null }),
  },
  storage: {
    from: () => ({
      createSignedUrls: async (paths: string[]) => later({ data: paths.map((p) => ({ path: p, signedUrl: imageUrl(p), error: null })), error: null }),
      createSignedUrl: async (p: string) => later({ data: { signedUrl: imageUrl(p) }, error: null }),
      remove: async () => ({ data: [], error: null }),
      upload: async () => ({ data: {}, error: null }),
    }),
  },
};

/** Attachment paths end in their picture number: .../img-3.png → /qa-img/3.png (served by ../serve.mjs). */
function imageUrl(path: string): string {
  const n = /img-(\d+)/.exec(path)?.[1] ?? "1";
  return `/qa-img/${n}.png`;
}

export function supabaseBrowser() {
  return client;
}
