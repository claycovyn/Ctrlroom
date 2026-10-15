/* eslint-disable @next/next/no-img-element */
import {
  BellIcon,
  ChatsIcon,
  CompassIcon,
  HeartIcon,
  HexIcon,
  HomeIcon,
  ImageIcon,
  ReplyIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/chat/icons";
import s from "./landing.module.css";

// An illustration of the signed-in Home (src/components/shell/AppShell.tsx, social/FeedView.tsx, PostItem.tsx and
// shell/CommunitiesPanel.tsx), drawn in HTML with the app's icons and colour tokens. Every name and post is an example.

function Face({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className={s.mockAvatar} style={{ width: size, height: size, fontSize: size < 30 ? 10 : 12 }}>
      {name.slice(0, 2)}
    </span>
  );
}

const NAV = [
  { label: "Home", icon: HomeIcon, on: true },
  { label: "Explore", icon: CompassIcon },
  { label: "Communities", icon: HexIcon },
  { label: "Messages", icon: ChatsIcon, badge: 2 },
  { label: "Activity", icon: BellIcon, badge: 4 },
  { label: "Profile", icon: UserIcon },
  { label: "Settings", icon: SettingsIcon },
];

function Rail() {
  return (
    <div className="hidden w-[13.5rem] shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">
      <img src="/brand/ctrlroom-icon-192.png" alt="" width={192} height={192} className="mb-3 ml-2 h-9 w-9" />
      {NAV.map((n) => (
        <div key={n.label} className={`flex h-11 items-center gap-3.5 rounded-xl px-3 text-[15px] ${n.on ? "font-semibold text-fg" : "text-fg/75"}`}>
          <span className="relative">
            <n.icon className="h-5 w-5" />
            {n.badge ? (
              <span className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-signal px-1 text-center text-[9px] font-bold leading-4 text-signal-fg">{n.badge}</span>
            ) : null}
          </span>
          {n.label}
        </div>
      ))}
      <span className="mt-3 flex h-10 w-full items-center justify-center rounded-full bg-signal text-sm font-semibold text-signal-fg">Post</span>
      <div className="mt-auto flex items-center gap-2.5 rounded-xl p-1.5">
        <Face name="Yo" size={32} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">You</div>
          <div className="truncate text-xs text-muted">@you</div>
        </div>
      </div>
    </div>
  );
}

function Post({
  name,
  handle,
  time,
  community,
  children,
  replies,
  likes,
  liked,
}: {
  name: string;
  handle: string;
  time: string;
  community?: string;
  children: React.ReactNode;
  replies?: number;
  likes?: number;
  liked?: boolean;
}) {
  return (
    <div className="border-b border-line px-4 pb-2.5 pt-3">
      {community && (
        <div className="mb-1.5 ml-[52px] flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
          <span className={`flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold text-fg ${s.tile}`}>{community.slice(0, 1)}</span>
          {community}
        </div>
      )}
      <div className="flex gap-3">
        <Face name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[14.5px]">
            <span className="font-semibold">{name}</span>
            <span className="truncate text-muted">@{handle} · {time}</span>
          </div>
          <div className="mt-0.5 text-[14.5px] leading-[1.45]">{children}</div>
          <div className="mt-2 flex items-center gap-7 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ReplyIcon className="h-4 w-4" />
              {replies || ""}
            </span>
            <span className={`inline-flex items-center gap-1.5 ${liked ? "text-fg" : ""}`}>
              <HeartIcon className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
              {likes || ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feed() {
  return (
    <div className="flex min-w-0 flex-1 flex-col border-line bg-bg lg:max-w-[34rem] lg:border-r">
      <div className="border-b border-line">
        <div className="px-4 pb-1 pt-3 text-lg font-bold tracking-tight">Home</div>
        <div className="flex text-[14.5px]">
          <span className="relative flex flex-1 justify-center py-3 font-semibold">
            Following
            <span className="absolute bottom-0 h-1 w-12 rounded-full bg-signal" />
          </span>
          <span className="flex flex-1 justify-center py-3 text-muted">Everyone</span>
        </div>
      </div>
      <div className="flex gap-3 border-b border-line px-4 py-3">
        <Face name="Yo" />
        <div className="min-w-0 flex-1">
          <div className="py-2 text-[16px] text-muted">Share something with your people</div>
          <div className="mt-1 flex items-center gap-2 border-t border-line pt-2.5">
            <ImageIcon className="h-[18px] w-[18px] text-muted" />
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium">Your followers</span>
            <span className="ml-auto rounded-full border border-line px-4 py-1 text-[13px] font-semibold text-muted">Post</span>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <Post name="Ana" handle="ana" time="12m" community="Studio" replies={4} likes={18} liked>
          Room icons are live. Every room picks one of the built-in set, and announcement rooms get the megaphone.
        </Post>
        <Post name="Sam" handle="sam" time="1h" replies={2} likes={9}>
          Notes from tonight&apos;s meetup are on the board in #events.
          <div className="mt-2 overflow-hidden rounded-xl border border-line">
            <div className={`h-20 ${s.cover}`} />
            <div className="px-3 py-2 text-[12.5px]">
              <div className="text-muted">example.com</div>
              <div className="font-medium">Meetup notes: what we decided</div>
            </div>
          </div>
        </Post>
        <Post name="Lee" handle="lee" time="3h" community="Night Shift" likes={6}>
          Voice lounge is open if anyone wants to pair on the release.
        </Post>
      </div>
    </div>
  );
}

const COMMUNITIES = [
  { name: "Studio", line: "1 mention · 3 rooms active", live: true },
  { name: "Night Shift", line: "2 rooms active", live: true },
  { name: "Book Club", line: "Private community" },
  { name: "Open Source", line: "Public community" },
];

function Aside() {
  return (
    <div className="hidden w-[18rem] shrink-0 flex-col gap-4 px-4 py-4 xl:flex">
      <div className="rounded-2xl border border-line bg-panel py-3">
        <p className="flex items-center justify-between px-4 text-[14px] font-bold">
          Your communities <span className="text-[11px] font-normal text-muted">5 rooms active</span>
        </p>
        <div className="mt-2">
          {COMMUNITIES.map((c) => (
            <div key={c.name} className="flex items-center gap-3 px-4 py-2">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold ${s.tile}`}>{c.name.slice(0, 2)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className={`block truncate text-[14px] ${c.live ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                <span className="block truncate text-[12px] text-muted">{c.line}</span>
              </span>
              {c.live && <span className={`h-2 w-2 rounded-full bg-signal ${s.pulse}`} />}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 px-4">
          <span className="rounded-md border border-line py-1.5 text-center text-[12px] font-medium">Start a community</span>
          <span className="rounded-md border border-line py-1.5 text-center text-[12px] font-medium">Join with invite</span>
        </div>
      </div>
      <div className="px-1">
        <p className="text-[14px] font-bold">Follows you</p>
        <div className="mt-2 flex items-center gap-3">
          <Face name="Jo" size={32} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[14px] font-medium">Jo</span>
            <span className="block text-[12px] text-muted">@jo</span>
          </span>
          <span className="rounded-full bg-signal px-3 py-1 text-[12px] font-semibold text-signal-fg">Follow back</span>
        </div>
      </div>
    </div>
  );
}

/** The product visual at the top of the landing page: Home, with the Feed and your communities beside it. */
export function HomeMock() {
  return (
    <div className={`${s.mock} flex justify-center overflow-hidden md:h-[36rem]`} aria-hidden="true">
      <Rail />
      <Feed />
      <Aside />
    </div>
  );
}
