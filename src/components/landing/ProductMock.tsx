/* eslint-disable @next/next/no-img-element */
import { RoomIconSvg } from "@/components/chat/RoomIcon";
import {
  BellIcon,
  BoardIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  PhoneIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  ThreadIcon,
  UsersIcon,
} from "@/components/chat/icons";
import { roomIconById, type RoomIconId } from "@/lib/roomIcons";
import s from "./landing.module.css";

// An illustration of the real app, drawn in HTML with the app's icons and colour tokens. Every name and message is
// an example. Layout follows src/components/chat (Sidebar, RoomView, MessageItem, ThreadPanel, CallPanel).

function Icon({ id, className = "h-4 w-4 shrink-0 opacity-70" }: { id: RoomIconId; className?: string }) {
  const icon = roomIconById(id);
  return icon ? <RoomIconSvg icon={icon} className={className} /> : null;
}

function Face({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className={s.mockAvatar} style={{ width: size, height: size, fontSize: size < 30 ? 10 : 12 }}>
      {name.slice(0, 2)}
    </span>
  );
}

type SideRoom = { id: RoomIconId; name: string; active?: boolean; unread?: boolean; mentions?: number };
const SECTIONS: { name: string; rooms: SideRoom[] }[] = [
  {
    name: "Community",
    rooms: [
      { id: "announcements", name: "announcements" },
      { id: "general", name: "general", unread: true },
      { id: "welcome", name: "welcome" },
    ],
  },
  {
    name: "Build",
    rooms: [
      { id: "design", name: "design", active: true },
      { id: "dev", name: "dev", unread: true, mentions: 2 },
      { id: "releases", name: "releases" },
    ],
  },
  { name: "Voice", rooms: [{ id: "voice", name: "lounge" }] },
];

function SideRow({ room }: { room: SideRoom }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm ${
        room.active ? "bg-raised font-medium text-fg" : room.unread ? "font-semibold text-fg" : "text-muted"
      }`}
    >
      <Icon id={room.id} />
      <span className="truncate">{room.name}</span>
      {room.mentions ? (
        <span className="ml-auto rounded-full bg-signal px-1.5 text-[11px] font-bold text-signal-fg">{room.mentions}</span>
      ) : null}
    </div>
  );
}

function Sidebar() {
  return (
    <div className="hidden w-[15.5rem] shrink-0 border-r border-line bg-panel md:flex">
      <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-bg py-3">
        <img src="/brand/ctrlroom-icon-192.png" alt="" width={192} height={192} className="h-9 w-9" />
        <span className="my-1 h-px w-6 bg-line" />
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold ring-2 ring-signal ${s.tile}`}>St</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-muted ${s.tile}`}>Rc</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-dashed border-line text-muted">+</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`h-14 border-b border-line ${s.cover}`} />
        <div className="flex h-12 items-center justify-between border-b border-line px-3">
          <span className="truncate font-semibold">Studio</span>
          <SettingsIcon className="h-4 w-4 text-muted" />
        </div>
        <div className="flex-1 overflow-hidden px-2 py-3">
          <div className="mb-3">
            <p className="mb-1 flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <PinIcon className="h-3 w-3" /> Pinned
            </p>
            <SideRow room={{ id: "ideas", name: "ideas" }} />
          </div>
          {SECTIONS.map((sec) => (
            <div key={sec.name} className="mb-3">
              <p className="flex items-center gap-1 px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <ChevronDownIcon className="h-3 w-3" />
                {sec.name}
              </p>
              {sec.rooms.map((r) => (
                <SideRow key={r.name} room={r} />
              ))}
              {sec.name === "Voice" && (
                <div className="ml-8 mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <Face name="Sa" size={18} />
                  <Face name="An" size={18} />
                  <span>in the call</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <Face name="Yo" size={30} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">You</div>
            <div className="truncate text-xs text-muted">@you</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({
  name,
  time,
  children,
  bot,
}: {
  name: string;
  time: string;
  children: React.ReactNode;
  bot?: boolean;
}) {
  return (
    <div className="flex gap-3 px-4 pb-0.5 pt-3">
      <Face name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{name}</span>
          {bot && <span className="rounded bg-signal px-1 text-[10px] font-bold uppercase leading-4 text-signal-fg">AI</span>}
          <span className="text-xs text-muted">{time}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="break-words text-[14.5px] leading-relaxed">{children}</div>;
}

function Reaction({ e, n, mine }: { e: string; n: number; mine?: boolean }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${mine ? "border-signal/60 bg-signal/10" : "border-line"}`}>
      {e} {n}
    </span>
  );
}

function Room() {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-12 items-center gap-2 border-b border-line px-4 sm:h-14">
        <Icon id="design" className="h-4 w-4 shrink-0 text-muted" />
        <span className="font-semibold">design</span>
        <span className="hidden truncate text-sm text-muted lg:inline">Icons, type and the dark theme</span>
        <span className="ml-auto flex items-center gap-0.5 text-muted">
          {[PhoneIcon, BoardIcon, SearchIcon, UsersIcon, BellIcon].map((I, i) => (
            <span key={i} className={`rounded p-1.5 ${i > 2 ? "hidden sm:inline-flex" : "inline-flex"}`}>
              <I className="h-4 w-4" />
            </span>
          ))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-raised/40 px-4 py-2.5">
        <PhoneIcon className="h-5 w-5 text-signal" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Call in #design</p>
          <p className="text-xs text-muted">Sam and Ana are in the call</p>
        </div>
        <div className="flex gap-2">
          <span className="btn-primary py-1 text-xs">Join voice</span>
          <span className="btn-outline hidden py-1 text-xs sm:inline-flex">Join with video</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden pb-2">
        <div className="mx-4 mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
          <span className="font-medium text-fg">While you were gone:</span> 14 new messages from Sam, Ana and Lee · 1 decision on the
          board
        </div>
        <Message name="Ana" time="10:04">
          <Body>Should announcement rooms get the megaphone icon by default?</Body>
          <div className="mt-1.5 flex items-start gap-2 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <span>
              <span className="font-medium">Outcome:</span> Yes. Voice rooms keep the speaker.
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-signal">
              <ThreadIcon className="h-3.5 w-3.5" /> 4 replies <span className="text-muted">· closed</span>
            </span>
          </div>
        </Message>
        <Message name="Sam" time="10:12">
          <Body>First pass at the room icons is up. All 2px stroke, so they match the rest of the app.</Body>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Reaction e="🔥" n={3} mine />
            <Reaction e="👀" n={1} />
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-signal">
              <ThreadIcon className="h-3.5 w-3.5" /> 2 replies
            </span>
          </div>
        </Message>
        <Message name="Lee" time="10:15">
          <Body>
            <span className="rounded bg-signal/15 px-0.5 font-medium">@ctrl</span> what contrast ratio do small labels need to pass AA?
          </Body>
        </Message>
      </div>

      <div className="h-5 truncate px-5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-fg">
          <span className={`h-1.5 w-1.5 rounded-full bg-signal ${s.pulse}`} />
          Ctrl · Searching the web: “WCAG contrast small text”
        </span>
      </div>
      <div className="px-4 pb-4 pt-1">
        <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-muted">Message #design · @ctrl for AI help</div>
      </div>
    </div>
  );
}

function Thread() {
  return (
    <div className="hidden w-[19rem] shrink-0 flex-col border-l border-line bg-panel xl:flex">
      <div className="flex h-14 items-center justify-between border-b border-line px-4">
        <span className="font-semibold">Thread</span>
        <CloseIcon className="h-4 w-4 text-muted" />
      </div>
      <div className="flex-1 overflow-hidden">
        <Message name="Sam" time="10:12">
          <Body>First pass at the room icons is up.</Body>
        </Message>
        <div className="my-3 flex items-center gap-3 px-4 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />2 replies
          <span className="h-px flex-1 bg-line" />
        </div>
        <Message name="Ana" time="10:20">
          <Body>The memes one made me laugh. Ship it?</Body>
        </Message>
        <Message name="Lee" time="10:22">
          <Body>One tweak to the bugs icon, then yes.</Body>
        </Message>
      </div>
      <div className="space-y-2 border-t border-line p-3">
        <span className="btn-outline w-full py-1.5 text-xs">
          <CheckIcon className="h-3.5 w-3.5" /> Close with an outcome
        </span>
        <div className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-muted">Reply in thread</div>
      </div>
    </div>
  );
}

/** The product visual on the landing page: HTML and CSS, no screenshot. */
export function ProductMock() {
  return (
    <div className={`${s.mock} flex overflow-hidden md:h-[36rem]`} aria-hidden="true">
      <Sidebar />
      <Room />
      <Thread />
    </div>
  );
}
