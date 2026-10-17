"use client";

// A throwaway prototype of the unified "one app" navigation (operator, 2026-10-17). Not wired into the real app:
// it's a self-contained page to feel the direction on a phone before rebuilding the shells. One spine on the left
// (Home, DMs, your communities, account) stays put; the content swaps. A community opens its channels in the same
// frame; a channel opens the chat with a back to the channel list. Mock data only.
import { useState } from "react";
import { ChatsIcon, ChevronLeftIcon, HashIcon, HomeIcon, MegaphoneIcon, PinIcon, PlusIcon, SearchIcon, SendIcon, SettingsIcon, VoiceIcon } from "@/components/chat/icons";

type Dest = { kind: "home" } | { kind: "dms" } | { kind: "community"; slug: string };

const COMMUNITIES = [
  { slug: "openctrl", name: "OpenCtrl", letter: "C" },
  { slug: "vhm", name: "VHM", letter: "V" },
  { slug: "curbs", name: "Curb's", letter: "Cu" },
];
const CHANNELS: Record<string, { section: string; items: { name: string; icon: "hash" | "voice" | "mega" | "pin"; unread?: boolean }[] }[]> = {
  openctrl: [
    { section: "Pinned", items: [{ name: "the-floor", icon: "pin" }] },
    { section: "Start here", items: [{ name: "announcements", icon: "mega" }, { name: "introduce-yourself", icon: "hash", unread: true }] },
    { section: "The collective", items: [{ name: "build-and-dev", icon: "hash" }, { name: "showcase", icon: "hash" }, { name: "off-topic", icon: "hash" }, { name: "lounge", icon: "voice" }] },
  ],
  vhm: [{ section: "Channels", items: [{ name: "general", icon: "hash" }, { name: "clients", icon: "hash", unread: true }] }],
  curbs: [{ section: "Channels", items: [{ name: "jobs", icon: "hash" }, { name: "crew", icon: "voice" }] }],
};
const DMS = [
  { name: "Abbey Walsh", last: "See you at the call", initials: "AW", unread: 0 },
  { name: "Andrew & Jayden", last: "sounds good", initials: "AJ", unread: 2 },
  { name: "Sarah Gibson", last: "sent the file", initials: "SG", unread: 0 },
];
const POSTS = [
  { who: "Clay", handle: "@clay", when: "1d", text: "Ctrl Room social is here! One place for your communities and the people in them." },
  { who: "Maya Ortiz", handle: "@maya", when: "3h", text: "Moved our weekly planning into a thread with an outcome. The decision sits on the board now." },
  { who: "Tomás Silva", handle: "@tomas", when: "5h", text: "First contributor call went well. Notes are up in #build-and-dev." },
];

const ChIcon = ({ t }: { t: "hash" | "voice" | "mega" | "pin" }) =>
  t === "voice" ? <VoiceIcon className="h-4 w-4 shrink-0 text-muted" /> : t === "mega" ? <MegaphoneIcon className="h-4 w-4 shrink-0 text-muted" /> : t === "pin" ? <PinIcon className="h-4 w-4 shrink-0 text-muted" /> : <HashIcon className="h-4 w-4 shrink-0 text-muted" />;

export default function PreviewNav() {
  const [dest, setDest] = useState<Dest>({ kind: "home" });
  const [channel, setChannel] = useState<string | null>(null);
  const [dm, setDm] = useState<string | null>(null);
  const go = (d: Dest) => {
    setDest(d);
    setChannel(null);
    setDm(null);
  };

  const spineBtn = (active: boolean, badge: number, onClick: () => void, label: string, node: React.ReactNode) => (
    <button type="button" onClick={onClick} aria-label={label} className="relative flex h-12 w-12 items-center justify-center">
      <span aria-hidden className={`absolute left-0 w-1 rounded-r-full bg-fg transition-all ${active ? "h-7" : "h-0 group-hover:h-2"}`} />
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all ${active ? "rounded-xl bg-signal text-signal-fg" : "bg-raised text-fg hover:rounded-xl hover:bg-line"}`}>{node}</span>
      {badge > 0 && <span className="absolute -right-0 -top-0 min-w-[18px] rounded-full bg-signal px-1 text-center text-[10px] font-bold leading-[18px] text-signal-fg ring-2 ring-bg">{badge}</span>}
    </button>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {/* The spine — the same on every screen. */}
      <nav aria-label="Spine" className="group flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg py-3">
        {spineBtn(dest.kind === "home", 0, () => go({ kind: "home" }), "Home", <HomeIcon className="h-5 w-5" />)}
        {spineBtn(dest.kind === "dms", 2, () => go({ kind: "dms" }), "Direct messages", <ChatsIcon className="h-5 w-5" />)}
        <span className="my-1 h-px w-7 bg-line" />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {COMMUNITIES.map((c) =>
            spineBtn(dest.kind === "community" && dest.slug === c.slug, c.slug === "openctrl" ? 0 : c.slug === "vhm" ? 3 : 0, () => go({ kind: "community", slug: c.slug }), c.name, <span className="text-[13px] font-bold">{c.letter}</span>),
          )}
          <button type="button" aria-label="Add a community" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-line text-muted hover:rounded-xl hover:border-fg/40 hover:text-fg">
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>
        <button type="button" aria-label="You" className="mt-1 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-raised text-[13px] font-semibold">C</button>
      </nav>

      {/* The content — swaps, same frame. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {dest.kind === "home" && <Home />}
        {dest.kind === "dms" && (dm ? <Chat title={DMS.find((d) => d.name === dm)!.name} onBack={() => setDm(null)} dm /> : <DmList onOpen={setDm} />)}
        {dest.kind === "community" &&
          (channel ? (
            <Chat title={channel} onBack={() => setChannel(null)} community={COMMUNITIES.find((c) => c.slug === (dest as { slug: string }).slug)!.name} />
          ) : (
            <Channels slug={dest.slug} onOpen={setChannel} />
          ))}
      </div>
    </div>
  );
}

function TopBar({ title, sub, back }: { title: string; sub?: string; back?: () => void }) {
  return (
    <div className="cr-safe-top sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur-xl">
      {back && (
        <button type="button" onClick={back} aria-label="Back" className="-ml-2 rounded-full p-2 hover:bg-raised">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-bold leading-tight">{title}</div>
        {sub && <div className="truncate text-[12px] leading-tight text-muted">{sub}</div>}
      </div>
    </div>
  );
}

function Home() {
  const [tab, setTab] = useState<"following" | "everyone">("following");
  return (
    <>
      <TopBar title="Home" />
      <div className="sticky top-14 z-10 flex border-b border-line bg-bg/85 backdrop-blur-xl">
        {(["following", "everyone"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`relative flex h-12 flex-1 items-center justify-center text-[15px] capitalize ${tab === t ? "font-semibold text-fg" : "font-medium text-muted"}`}>
            {t}
            {tab === t && <span className="absolute bottom-0 h-1 w-14 rounded-full bg-signal" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {POSTS.map((p, i) => (
          <article key={i} className="flex gap-3 border-b border-line px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold">{p.who.slice(0, 2)}</span>
            <div className="min-w-0">
              <div className="text-[15px]">
                <span className="font-semibold">{p.who}</span> <span className="text-muted">{p.handle} · {p.when}</span>
              </div>
              <p className="text-[15px] leading-snug text-fg/90">{p.text}</p>
            </div>
          </article>
        ))}
      </div>
      <Composer placeholder="Share something with your people" />
    </>
  );
}

function Channels({ slug, onOpen }: { slug: string; onOpen: (c: string) => void }) {
  const name = COMMUNITIES.find((c) => c.slug === slug)!.name;
  return (
    <>
      <TopBar title={name} sub="Community" />
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-raised px-3 py-2 text-sm text-muted">
          <SearchIcon className="h-4 w-4 shrink-0" /> Search {name}
        </div>
        <button type="button" className="rounded-lg bg-raised p-2 text-muted" aria-label="Community settings">
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {CHANNELS[slug].map((sec) => (
          <div key={sec.section} className="mb-4">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{sec.section}</div>
            {sec.items.map((it) => (
              <button key={it.name} type="button" onClick={() => onOpen(it.name)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-raised">
                <ChIcon t={it.icon} />
                <span className={`min-w-0 flex-1 truncate ${it.unread ? "font-semibold text-fg" : "text-fg/80"}`}>{it.name}</span>
                {it.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function DmList({ onOpen }: { onOpen: (n: string) => void }) {
  return (
    <>
      <TopBar title="Direct messages" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {DMS.map((d) => (
          <button key={d.name} type="button" onClick={() => onOpen(d.name)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left hover:bg-raised">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold">{d.initials}</span>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[15px] ${d.unread ? "font-semibold" : "font-medium"}`}>{d.name}</div>
              <div className="truncate text-[13px] text-muted">{d.last}</div>
            </div>
            {d.unread > 0 && <span className="min-w-[20px] rounded-full bg-signal px-1.5 text-center text-[11px] font-bold leading-5 text-signal-fg">{d.unread}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

function Chat({ title, onBack, community, dm }: { title: string; onBack: () => void; community?: string; dm?: boolean }) {
  return (
    <>
      <TopBar title={dm ? title : `# ${title}`} sub={community} back={onBack} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {[
          { who: "Maya Ortiz", text: "This is looking great. Shipping the update today." },
          { who: "Clay", text: "Love it. Let's get it in front of the floor." },
          { who: "Tomás Silva", text: "Added notes above ☝️" },
        ].map((m, i) => (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold">{m.who.slice(0, 2)}</span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{m.who}</div>
              <p className="text-[15px] leading-snug text-fg/90">{m.text}</p>
            </div>
          </div>
        ))}
      </div>
      <Composer placeholder={dm ? `Message ${title}` : `Message #${title}`} />
    </>
  );
}

function Composer({ placeholder }: { placeholder: string }) {
  return (
    <div className="cr-safe-bottom flex items-center gap-2 border-t border-line px-3 py-2.5">
      <button type="button" className="rounded-full p-2 text-muted" aria-label="Add">
        <PlusIcon className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 truncate rounded-full bg-raised px-4 py-2.5 text-[15px] text-muted">{placeholder}</div>
      <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-signal text-signal-fg" aria-label="Send">
        <SendIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
