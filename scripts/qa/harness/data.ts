/* eslint-disable @typescript-eslint/no-explicit-any */
// QA harness: a realistic dataset. 3 communities, 12 rooms in sections with icons and pins, ~20 people with presence,
// 320 messages in #general (threads, reactions, images, files, code, links, mentions), smaller rooms, DMs.
// Deterministic (seeded), so runs compare.
import type { Community, Message, Profile, Reaction, Room, RoomSection } from "@/lib/types";

let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const id = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NAMES = [
  "Clay Sinclair", "Maya Ortiz", "Sam Lee", "Priya Shah", "Jonah Kim", "Ana Ruiz", "Leo Park", "Noor Haddad", "Iris Chen", "Tomás Silva",
  "Grace Obi", "Ravi Menon", "Elena Petrova", "Kofi Mensah", "Hana Sato", "Owen Price", "Lucia Romano", "Ben Carter", "Yara Nasser", "Felix Wolf",
];
export const profiles: Profile[] = NAMES.map((n, i) => ({ id: id("a", i + 1), username: n.split(" ")[0].toLowerCase().normalize("NFKD").replace(/[^a-z]/g, ""), display_name: n, avatar_url: null }));
profiles.push({ id: id("a", 99), username: "ctrl", display_name: "Ctrl", avatar_url: null, is_bot: true });
export const me = profiles[0];

export const communities: Community[] = [
  { id: id("d", 1), slug: "night-shift", name: "Night Shift", description: "Where the late crew builds.", icon: "N", is_public: false, owner_id: me.id, icon_url: null, cover_url: null },
  { id: id("d", 2), slug: "design-club", name: "Design Club", description: "", icon: "D", is_public: true, owner_id: profiles[2].id, icon_url: null, cover_url: null },
  { id: id("d", 3), slug: "oss-crew", name: "OSS Crew", description: "", icon: "O", is_public: true, owner_id: profiles[5].id, icon_url: null, cover_url: null },
];

const sec = (c: number, n: number, name: string, position: number): RoomSection => ({ id: id("b", c * 10 + n), community_id: id("d", c), name, position });
export const sections: RoomSection[] = [sec(1, 1, "Team", 0), sec(1, 2, "Projects", 1), sec(1, 3, "Hangout", 2), sec(2, 1, "Studio", 0)];

let rn = 0;
const room = (c: number, slug: string, section: string | null, icon: string | null, kind: "text" | "voice" = "text", topic = ""): Room => ({
  id: id("c", ++rn), community_id: id("d", c), slug, name: slug, topic, description: topic ? `${topic}. Be kind, stay on topic.` : "", kind,
  post_min_role: slug === "announcements" ? "admin" : "member", position: rn, section_id: section, icon,
});
export const rooms: Room[] = [
  room(1, "general", null, "general", "text", "Anything goes"),
  room(1, "announcements", null, "announcements", "text", "News from the team"),
  room(1, "standup", sections[0].id, "events"),
  room(1, "design", sections[0].id, "design", "text", "Pixels and principles"),
  room(1, "engineering", sections[0].id, "dev"),
  room(1, "launch-plan", sections[1].id, "releases", "text", "Shipping v2"),
  room(1, "mobile-app", sections[1].id, "mobile"),
  room(1, "research", sections[1].id, "docs"),
  room(1, "random", sections[2].id, "off-topic"),
  room(1, "music", sections[2].id, "music"),
  room(1, "voice-lounge", sections[2].id, null, "voice"),
  room(1, "late-night-call", sections[2].id, null, "voice"),
  room(2, "general", null, "general"),
  room(2, "critique", sections[3].id, "art"),
  room(2, "studio-call", sections[3].id, null, "voice"),
  room(3, "general", null, "general"),
  room(3, "triage", null, "bugs"),
];
export const pins = [{ room_id: rooms[5].id, created_at: new Date(Date.now() - 86_400_000).toISOString() }];

const LINES = [
  "Morning! The new build is up on staging.",
  "Nice. The room switcher feels a lot snappier.",
  "@clay can you check it on your phone before we ship?",
  "I tried it on mine: no more zoom when you tap the message box.",
  "Notifications came through on Android too 👍",
  "Let's call it for today then.",
  "Here's the diff: `git log --oneline main..release` shows 14 commits.",
  "Docs: https://example.com/docs/release-notes is the draft.",
  "```\nnpm run build\nnpm run test -- --run\n```\nboth green locally.",
  "Could someone look at the onboarding copy? It reads a bit long to me. I'd cut the second paragraph entirely and move the pricing note into the FAQ, then link to it from the welcome screen so people who care can find it.",
  "+1",
  "lol",
  "Pushed a fix for the avatar crop on Safari.",
  "Who's on call this weekend?",
  "@maya the board is updated with the decisions from today.",
  "Moving the retro to Thursday, same time.",
  "Has anyone seen the flaky test in CI again? It passed on rerun.",
  "The new icons look great on the dark theme.",
  "I'll write up the migration plan tonight and share it here.",
  "Quick poll: ship Friday or Monday?",
];
const EMOJI = ["👍", "❤️", "😂", "🔥", "👀", "✅"];
const t0 = Date.now() - 6 * 86_400_000;

export const messages: Message[] = [];
export const reactions: Reaction[] = [];
let mn = 0;
function addMessages(r: Room, count: number, imagesEvery = 0) {
  const span = Date.now() - 60_000 - t0;
  let last = profiles[0].id;
  for (let i = 0; i < count; i++) {
    mn += 1;
    const author = rnd() < 0.45 ? last : pick(profiles.slice(0, 20)).id;
    last = author;
    const m: Message = {
      id: id("e", mn), room_id: r.id, community_id: r.community_id, author_id: author, parent_id: null, body: pick(LINES), reply_count: 0,
      last_reply_at: null, resolved_at: null, resolved_by: null, outcome: null, edited_at: rnd() < 0.05 ? new Date().toISOString() : null,
      deleted_at: null, created_at: new Date(t0 + (span * i) / count).toISOString(), attachments: [],
    };
    if (imagesEvery && i % imagesEvery === 3) {
      const n = 1 + Math.floor(rnd() * 4);
      m.attachments = Array.from({ length: n }, (_, k) => ({
        id: `att-${mn}-${k}`, path: `room/${r.community_id}/${r.id}/${mn}/img-${(k % 4) + 1}.png`, name: `photo-${k + 1}.png`, mime: "image/png",
        size_bytes: 240_000, width: 1200, height: k % 2 ? 900 : 1600, alt: null, position: k,
      }));
      if (rnd() < 0.3) m.body = "";
    } else if (imagesEvery && i % imagesEvery === 7) {
      m.attachments = [{ id: `att-${mn}-f`, path: `room/${r.community_id}/${r.id}/${mn}/plan.pdf`, name: "launch-plan.pdf", mime: "application/pdf", size_bytes: 1_400_000, width: null, height: null, alt: null, position: 0 }];
    }
    if (rnd() < 0.08) m.deleted_at = m.created_at;
    if (m.deleted_at) m.body = "";
    messages.push(m);
    if (rnd() < 0.3) {
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) reactions.push({ message_id: m.id, user_id: pick(profiles.slice(0, 20)).id, emoji: pick(EMOJI) });
    }
    if (rnd() < 0.07 && !m.deleted_at) {
      const replies = 2 + Math.floor(rnd() * 8);
      m.reply_count = replies;
      m.last_reply_at = m.created_at;
      if (rnd() < 0.3) {
        m.resolved_at = m.created_at;
        m.outcome = "Ship Monday, with the onboarding copy cut.";
      }
      for (let j = 0; j < replies; j++) {
        mn += 1;
        messages.push({ ...m, id: id("e", mn), parent_id: m.id, reply_count: 0, outcome: null, resolved_at: null, attachments: [], author_id: pick(profiles.slice(0, 20)).id, body: pick(LINES), created_at: new Date(Date.parse(m.created_at) + (j + 1) * 60_000).toISOString() });
      }
    }
  }
}
addMessages(rooms[0], 320, 11);
for (const r of rooms.slice(1)) if (r.kind === "text") addMessages(r, 40, 15);

export const unreads = rooms
  .filter((r, i) => i % 3 === 1)
  .map((r, i) => ({ room_id: r.id, unread: 3 + i, mentions: i % 2 ? 1 : 0, notify: i === 2 ? "none" : "mentions" }));

/** Presence for most people: online, away, dnd, two in a call. */
export function peers(now = Date.now()): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  profiles.slice(1, 20).forEach((p, i) => {
    if (i % 5 === 4) return; // offline
    const status = i % 7 === 3 ? "dnd" : i % 4 === 2 ? "away" : "online";
    const call = i === 1 || i === 6 ? { room_id: rooms[10].id, video: i === 6 } : null;
    out[p.id] = [{ user_id: p.id, status, call, since: new Date(now - i * 60_000).toISOString(), presence_ref: `r${i}` }];
  });
  return out;
}

// ── direct messages
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const mem = (i: number) => ({ user_id: profiles[i].id, username: profiles[i].username, display_name: profiles[i].display_name, avatar_url: null, status: "active" });
export const dmConversations = [
  { id: id("9", 1), is_group: false, title: null, created_by: me.id, created_at: ago(9000), last_message_at: ago(4), status: "active", ignored: false, muted: false, last_read_at: ago(60), unread: 2, members: [mem(0), mem(1)], last_message: { id: "dm-1-40", author_id: profiles[1].id, body: "Can you look at the cover photo before Friday?", created_at: ago(4), deleted: false } },
  { id: id("9", 2), is_group: true, title: "Launch crew", created_by: me.id, created_at: ago(9000), last_message_at: ago(12), status: "active", ignored: false, muted: false, last_read_at: ago(60), unread: 5, members: [mem(0), mem(2), mem(3), mem(4)], last_message: { id: "dm-2-40", author_id: profiles[2].id, body: "Ship it. I'll write the notes tonight.", created_at: ago(12), deleted: false } },
  { id: id("9", 3), is_group: false, title: null, created_by: me.id, created_at: ago(9000), last_message_at: ago(180), status: "active", ignored: false, muted: true, last_read_at: ago(60), unread: 0, members: [mem(0), mem(5)], last_message: { id: "dm-3-40", author_id: me.id, body: "Thanks, that fixed it", created_at: ago(180), deleted: false } },
];
export const dmMessages = dmConversations.flatMap((c, ci) =>
  Array.from({ length: 40 }, (_, i) => ({
    id: `dm-${ci + 1}-${i + 1}`, conversation_id: c.id, author_id: i % 3 === 0 ? me.id : c.members[1 + (i % (c.members.length - 1))].user_id, body: LINES[(i + ci) % LINES.length],
    edited_at: null, deleted_at: null, created_at: ago(400 - i * 9), attachments: [],
  })),
);
