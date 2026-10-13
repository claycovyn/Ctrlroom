// Room icons: original artwork made for Ctrl Room (same license as the app). 24×24, drawn with a 2px stroke in
// currentColor, rendered by <RoomIcon> in src/components/chat/RoomIcon.tsx. Each shape is a path (d) or a circle
// (cx, cy, r). Saved in rooms.icon (0009_room_icons.sql); the DB only checks the shape of the id, so the app treats
// any id that isn't listed here as "no icon".

export const ROOM_ICON_IDS = [
  "general",
  "announcements",
  "welcome",
  "rules",
  "introductions",
  "lounge",
  "off-topic",
  "voice",
  "events",
  "music",
  "gaming",
  "help",
  "support",
  "feedback",
  "ideas",
  "bugs",
  "releases",
  "changelog",
  "dev",
  "design",
  "showcase",
  "media",
  "video",
  "photos",
  "links",
  "docs",
  "learning",
  "ai",
  "data",
  "ops",
  "security",
  "jobs",
  "money",
  "sales",
  "marketing",
  "news",
  "world",
  "mobile",
  "books",
  "art",
  "writing",
  "food",
  "travel",
  "sports",
  "health",
  "memes",
] as const;

export type RoomIconId = (typeof ROOM_ICON_IDS)[number];

export type RoomIconShape = { d: string } | { cx: number; cy: number; r: number };

export interface RoomIconDef {
  id: RoomIconId;
  label: string;
  shapes: readonly RoomIconShape[];
}

export const ROOM_ICONS: readonly RoomIconDef[] = [
  {
    id: "general",
    label: "General",
    shapes: [
      { d: "M14 2.5 21.5 7v10L14 21.5 6.5 17V7Z" },
      { d: "M7 3.5 3 6v12l4 2.5" },
      { d: "M10.5 10h7M10.5 14h7M12.25 8v8M15.75 8v8" },
    ],
  },
  {
    id: "announcements",
    label: "Announcements",
    shapes: [
      { d: "M3 9l3-3h9l3 3v5l-3 3H8.5L3 21.5Z" },
      { d: "M7 2.5h11l3.5 3.5v8" },
      { d: "M10.5 8.5v3.5" },
      { cx: 10.5, cy: 14.5, r: 0.75 },
    ],
  },
  {
    id: "welcome",
    label: "Welcome",
    shapes: [
      { d: "M8 21V7l3-3h6l3 3v14" },
      { d: "M3 21h18" },
      { d: "M8 21 4 19V9l4-2" },
      { cx: 16, cy: 13.5, r: 0.75 },
    ],
  },
  {
    id: "rules",
    label: "Rules",
    shapes: [
      { d: "M12 2.5 19.5 5v7.5l-7.5 9-7.5-9V5Z" },
      { d: "M8.5 11.5l2.5 2.5 4.5-4.5" },
    ],
  },
  {
    id: "introductions",
    label: "Introductions",
    shapes: [
      { d: "M5 5H19L22 8V16L19 19H5L2 16V8Z" },
      { cx: 8.5, cy: 10.5, r: 2 },
      { d: "M5.5 15.5l1-1h4l1 1" },
      { d: "M14.5 10h4M14.5 14h3" },
    ],
  },
  {
    id: "lounge",
    label: "Lounge",
    shapes: [
      { d: "M4 9h12v6l-3 4H7l-3-4Z" },
      { d: "M16 11h2.5l1.5 1.5-1.5 1.5H16" },
      { d: "M8 3.5v2.5M12 3.5v2.5" },
    ],
  },
  {
    id: "off-topic",
    label: "Off-topic",
    shapes: [
      { d: "M7 3H17L21 7V17L17 21H7L3 17V7Z" },
      { cx: 8.25, cy: 8.25, r: 0.75 },
      { cx: 12, cy: 12, r: 0.75 },
      { cx: 15.75, cy: 15.75, r: 0.75 },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    shapes: [
      { d: "M6 4 3 7v10l3 3" },
      { d: "M7.5 10H10l4-3.5v11L10 14H7.5Z" },
      { d: "M17 9.5a3.5 3.5 0 0 1 0 5M19.5 7a7 7 0 0 1 0 10" },
    ],
  },
  {
    id: "events",
    label: "Events / stage",
    shapes: [
      { d: "M6 5H18L21 8V18L18 21H6L3 18V8Z" },
      { d: "M3 10h18M8 3v4M16 3v4" },
      { cx: 12, cy: 15.5, r: 0.75 },
    ],
  },
  {
    id: "music",
    label: "Music",
    shapes: [
      { d: "M9 18V5.5L20 3v12.5" },
      { cx: 6.5, cy: 18, r: 2.5 },
      { cx: 17.5, cy: 15.5, r: 2.5 },
    ],
  },
  {
    id: "gaming",
    label: "Gaming",
    shapes: [
      { d: "M7 7h10l4 4v5l-2 2h-2l-2-3H9l-2 3H5l-2-2v-5Z" },
      { d: "M7.5 10v3M6 11.5h3" },
      { cx: 15.5, cy: 10.75, r: 0.75 },
      { cx: 17.5, cy: 12.75, r: 0.75 },
    ],
  },
  {
    id: "help",
    label: "Help",
    shapes: [
      { d: "M3 6L6 3H18L21 6V13L18 16H9L3 21Z" },
      { d: "M9.5 7.5 11 6h2l1.5 1.5v1L12 10.5v.5" },
      { cx: 12, cy: 13.5, r: 0.75 },
    ],
  },
  {
    id: "support",
    label: "Support",
    shapes: [
      { d: "M8 2.5H16L21.5 8V16L16 21.5H8L2.5 16V8Z" },
      { d: "M10.5 8H13.5L16 10.5V13.5L13.5 16H10.5L8 13.5V10.5Z" },
      { d: "M5.25 5.25l3.5 3.5M18.75 5.25l-3.5 3.5M5.25 18.75l3.5-3.5M18.75 18.75l-3.5-3.5" },
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    shapes: [
      { d: "M3 6L6 3H18L21 6V13L18 16H9L3 21Z" },
      { d: "M8 7.5h8M8 11h5" },
    ],
  },
  {
    id: "ideas",
    label: "Ideas",
    shapes: [
      { d: "M9 15v-1.5l-3-3v-4L9 3h6l3 3.5v4l-3 3V15Z" },
      { d: "M9.5 18h5M10.5 21h3" },
    ],
  },
  {
    id: "bugs",
    label: "Bugs",
    shapes: [
      { d: "M12 21l-5-4v-7l2-2h6l2 2v7Z" },
      { d: "M9.5 8a2.5 2.5 0 0 1 5 0" },
      { d: "M7 12H3.5M17 12h3.5M7 16l-3 2M17 16l3 2M10 5.5 8.5 3.5M14 5.5l1.5-2" },
    ],
  },
  {
    id: "releases",
    label: "Releases",
    shapes: [
      { d: "M12 2 16.5 7v8l-2 2h-5l-2-2V7Z" },
      { d: "M7.5 11 4.5 14v4l3-1.5M16.5 11l3 3v4l-3-1.5" },
      { cx: 12, cy: 9.5, r: 1.5 },
      { d: "M12 20v2" },
    ],
  },
  {
    id: "changelog",
    label: "Changelog",
    shapes: [
      { d: "M3 6l1.5 1.5 3-3M3 12l1.5 1.5 3-3M3 18l1.5 1.5 3-3" },
      { d: "M11 6h10M11 12h10M11 18h7" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    shapes: [
      { d: "M5 4H19L22 7V17L19 20H5L2 17V7Z" },
      { d: "M9 9.5 6.5 12 9 14.5M15 9.5l2.5 2.5-2.5 2.5M13 8.5l-2 7" },
    ],
  },
  {
    id: "design",
    label: "Design",
    shapes: [
      { d: "M12 2.5 18.5 10.5l-2.5 6.5H8l-2.5-6.5Z" },
      { d: "M12 2.5V9" },
      { cx: 12, cy: 11, r: 1.75 },
      { d: "M8 21h8" },
    ],
  },
  {
    id: "showcase",
    label: "Showcase",
    shapes: [
      { d: "M9 6H18L21 9V18L18 21H9L6 18V9Z" },
      { d: "M2.5 13.5V5.5l3-3h8" },
      { d: "M13.5 8.75l1.4 3 3.1.4-2.3 2.2.6 3.15-2.8-1.6-2.8 1.6.6-3.15-2.3-2.2 3.1-.4Z" },
    ],
  },
  {
    id: "media",
    label: "Media",
    shapes: [
      { d: "M6 3H18L21 6V18L18 21H6L3 18V6Z" },
      { d: "M5.5 18.5l4.5-5 3.5 3.5 2-2 3 3" },
      { cx: 15.5, cy: 8.5, r: 1.5 },
    ],
  },
  {
    id: "video",
    label: "Video",
    shapes: [
      { d: "M5 5H19L22 8V16L19 19H5L2 16V8Z" },
      { d: "M10 9v6l5-3Z" },
    ],
  },
  {
    id: "photos",
    label: "Photos",
    shapes: [
      { d: "M3 8l2-2h3l1.5-2h5L16 6h3l2 2v10l-2 2H5l-2-2Z" },
      { cx: 12, cy: 13, r: 3.5 },
    ],
  },
  {
    id: "links",
    label: "Links",
    shapes: [
      { d: "M10 8H5l-3 3v2l3 3h5M14 8h5l3 3v2l-3 3h-5" },
      { d: "M8 12h8" },
    ],
  },
  {
    id: "docs",
    label: "Docs",
    shapes: [
      { d: "M5 19V5l2-2h12v14H7l-2 2 2 2h12v-4" },
      { d: "M10 7.5h5" },
    ],
  },
  {
    id: "learning",
    label: "Learning",
    shapes: [
      { d: "M12 4 22 9l-10 5L2 9Z" },
      { d: "M6 11v5l2 2h8l2-2v-5" },
      { d: "M22 9v5" },
    ],
  },
  {
    id: "ai",
    label: "AI",
    shapes: [
      { d: "M12 6.5l1.6 3.9 3.9 1.6-3.9 1.6-1.6 3.9-1.6-3.9-3.9-1.6 3.9-1.6Z" },
      { d: "M12 2.5A9.5 9.5 0 1 0 21.5 12" },
      { cx: 18.7, cy: 5.3, r: 0.75 },
    ],
  },
  {
    id: "data",
    label: "Data",
    shapes: [
      { d: "M4 6l3-3h10l3 3-3 3H7Z" },
      { d: "M4 6v12l3 3h10l3-3V6" },
      { d: "M4 12l3 3h10l3-3" },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    shapes: [
      { d: "M5 3H19L21 5V8L19 10H5L3 8V5Z" },
      { d: "M5 14H19L21 16V19L19 21H5L3 19V16Z" },
      { cx: 7, cy: 6.5, r: 0.75 },
      { cx: 7, cy: 17.5, r: 0.75 },
      { d: "M11 6.5h6M11 17.5h6" },
    ],
  },
  {
    id: "security",
    label: "Security",
    shapes: [
      { d: "M8 11V7l2-2.5h4L16 7v4" },
      { d: "M7 11H17L20 14V18L17 21H7L4 18V14Z" },
      { d: "M12 15v2" },
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    shapes: [
      { d: "M5 7H19L22 10V17L19 20H5L2 17V10Z" },
      { d: "M9 7V5l1-1h4l1 1v2" },
      { d: "M2 12.5h20" },
    ],
  },
  {
    id: "money",
    label: "Money",
    shapes: [
      { d: "M5 6H19L22 9V15L19 18H5L2 15V9Z" },
      { cx: 12, cy: 12, r: 2.5 },
      { cx: 6.25, cy: 12, r: 0.75 },
      { cx: 17.75, cy: 12, r: 0.75 },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    shapes: [
      { d: "M3 3v18h18" },
      { d: "M7 15l4-4 3 3 6-6" },
      { d: "M16 8h4v4" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    shapes: [
      { d: "M4 9.5h4l9-5v15l-9-5H4l-1-1v-3Z" },
      { d: "M8 14.5 9.5 19.5h2" },
      { d: "M20.5 10v4" },
    ],
  },
  {
    id: "news",
    label: "News",
    shapes: [
      { d: "M6.5 3H17.5L20 5.5V18.5L17.5 21H6.5L4 18.5V5.5Z" },
      { d: "M8.5 6.5H11L12 7.5V10L11 11H8.5L7.5 10V7.5Z" },
      { d: "M15 8.75h1.5M7.5 14.5h9M7.5 17.5h6" },
    ],
  },
  {
    id: "world",
    label: "World",
    shapes: [
      { cx: 12, cy: 12, r: 9.5 },
      { d: "M12 2.5 15.5 7v10L12 21.5 8.5 17V7Z" },
      { d: "M2.5 12h19" },
    ],
  },
  {
    id: "mobile",
    label: "Mobile",
    shapes: [
      { d: "M9 2H15L18 5V19L15 22H9L6 19V5Z" },
      { d: "M10.5 5.5h3" },
      { cx: 12, cy: 18.5, r: 0.75 },
    ],
  },
  {
    id: "books",
    label: "Books",
    shapes: [
      { d: "M12 7 9 4H2v14h7l3 3 3-3h7V4h-7Z" },
      { d: "M12 7v14" },
    ],
  },
  {
    id: "art",
    label: "Art",
    shapes: [
      { d: "M8 3h7l6 6v3l-3 3h-3l-1.5 1.5V19L12 21H9l-6-6V8Z" },
      { cx: 8, cy: 9.5, r: 0.75 },
      { cx: 12, cy: 7.5, r: 0.75 },
      { cx: 16, cy: 10, r: 0.75 },
      { cx: 8, cy: 14, r: 0.75 },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    shapes: [
      { d: "M15 4l5 5L9 20H4v-5Z" },
      { d: "M12.5 6.5l5 5" },
      { d: "M13 21h8" },
    ],
  },
  {
    id: "food",
    label: "Food",
    shapes: [
      { d: "M3 11h18v2l-4 5H7l-4-5Z" },
      { d: "M9 18v2.5h6V18" },
      { d: "M9 4v3.5M13 4v3.5" },
    ],
  },
  {
    id: "travel",
    label: "Travel",
    shapes: [
      { d: "M12 2.5l1.5 1.5v5l7.5 5v2l-7.5-2.5V18l2.5 2v1.5l-4-1-4 1V20l2.5-2v-4.5L3 16v-2l7.5-5V4Z" },
    ],
  },
  {
    id: "sports",
    label: "Sports",
    shapes: [
      { cx: 12, cy: 12, r: 9.5 },
      { d: "M12 8l3.5 2.5-1.5 4h-4l-1.5-4Z" },
      { d: "M12 8V2.5M15.5 10.5l5.5-2M14 14.5l3 4.5M10 14.5l-3 4.5M8.5 10.5l-5.5-2" },
    ],
  },
  {
    id: "health",
    label: "Health",
    shapes: [
      { d: "M12 20l-8-8V8l3-3h2l3 3 3-3h2l3 3v4Z" },
      { d: "M7 12h2l1.5-2.5 2 4 1.5-1.5h3" },
    ],
  },
  {
    id: "memes",
    label: "Memes",
    shapes: [
      { d: "M8 3H16L21 8V16L16 21H8L3 16V8Z" },
      { d: "M7.5 10 9 8.5l1.5 1.5M13.5 10 15 8.5l1.5 1.5" },
      { d: "M8 13.5h8l-1.5 3h-5Z" },
    ],
  },
];

const BY_ID = new Map<string, RoomIconDef>(ROOM_ICONS.map((i) => [i.id, i]));

/** The icon for a saved rooms.icon value, or null (none saved, or an id this version doesn't know). */
export function roomIconById(id: string | null | undefined): RoomIconDef | null {
  return (id && BY_ID.get(id)) || null;
}

export function isRoomIconId(id: unknown): id is RoomIconId {
  return typeof id === "string" && BY_ID.has(id);
}

/** Icons whose label or id contains every word of the search (case-insensitive), in their usual order. */
export function searchRoomIcons(query: string): RoomIconDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...ROOM_ICONS];
  return ROOM_ICONS.filter((i) => {
    const hay = `${i.label} ${i.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Words in a room name that suggest an icon (besides the icon's own id). */
const WORDS: Partial<Record<RoomIconId, string[]>> = {
  general: ["main", "chat", "talk"],
  announcements: ["announcement", "announce", "notices", "notice"],
  welcome: ["start", "hello", "hi", "start-here", "lobby"],
  rules: ["guidelines", "code-of-conduct", "coc"],
  introductions: ["introduction", "intros", "intro", "introduce-yourself"],
  lounge: ["floof", "hangout", "hang", "chill", "social", "cafe"],
  "off-topic": ["offtopic", "random", "misc"],
  voice: ["vc", "call", "calls", "voice-chat"],
  events: ["event", "meetups", "meetup", "calendar"],
  music: ["songs", "jams", "audio"],
  gaming: ["games", "game", "play"],
  help: ["questions", "question", "ask", "qa", "q-a", "faq"],
  feedback: ["reviews", "critique"],
  ideas: ["idea", "suggestions", "suggestion", "requests"],
  bugs: ["bug", "issues", "issue", "bug-reports"],
  releases: ["release", "updates", "update", "ship", "shipping"],
  dev: ["development", "build", "builds", "building", "code", "coding", "engineering", "programming", "devs"],
  showcase: ["show-and-tell", "projects", "project", "share"],
  video: ["videos", "streams", "stream", "streaming"],
  photos: ["photo", "pics", "pictures", "photography"],
  links: ["link", "resources-links"],
  docs: ["documentation", "doc", "wiki", "guides"],
  learning: ["learn", "study", "resources", "tutorials", "courses"],
  ai: ["ml", "llm", "agents"],
  data: ["analytics", "metrics"],
  ops: ["devops", "infra", "infrastructure", "deploys"],
  security: ["sec", "infosec"],
  jobs: ["job", "hiring", "careers"],
  money: ["finance", "budget", "payments"],
  news: ["press"],
  world: ["international", "global"],
  mobile: ["ios", "android", "apps"],
  books: ["book", "reading", "book-club"],
  art: ["drawing", "artwork"],
  writing: ["writers", "poetry"],
  food: ["cooking", "recipes", "eats"],
  sports: ["sport", "football", "soccer"],
  health: ["fitness", "wellness", "gym"],
  memes: ["meme", "funny", "jokes"],
};

const SUGGEST = new Map<string, RoomIconId>();
for (const i of ROOM_ICONS) SUGGEST.set(i.id, i.id);
for (const [id, words] of Object.entries(WORDS) as [RoomIconId, string[]][]) for (const w of words) if (!SUGGEST.has(w)) SUGGEST.set(w, id);

/**
 * An icon to start with for a new room, from its name ("announcements" → announcements, "dev-chat" → dev), or null
 * for the default. Tries the whole name, then each pair of words, then each word from the left.
 */
export function suggestRoomIcon(name: string): RoomIconId | null {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  const words = slug.split("-");
  const pairs = words.slice(1).map((w, i) => `${words[i]}-${w}`);
  for (const key of [slug, ...pairs, ...words]) {
    const hit = SUGGEST.get(key) ?? (key.length > 3 && key.endsWith("s") ? SUGGEST.get(key.slice(0, -1)) : undefined);
    if (hit) return hit;
  }
  return null;
}
