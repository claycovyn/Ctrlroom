import { HeartIcon, ImageIcon, ReplyIcon } from "@/components/chat/icons";
import s from "./landing.module.css";

// Small drawings for the "Posts and follows" cards. Decorative: each card's heading and text say the same thing.

function Face({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className={s.mockAvatar} style={{ width: size, height: size, fontSize: size < 30 ? 10 : 12 }}>
      {name.slice(0, 2)}
    </span>
  );
}

export function TabsArt() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel text-sm" aria-hidden="true">
      <div className="flex border-b border-line">
        <span className="relative flex flex-1 justify-center py-2 font-semibold">
          Following
          <span className="absolute bottom-0 h-0.5 w-10 rounded-full bg-signal" />
        </span>
        <span className="flex flex-1 justify-center py-2 text-muted">Everyone</span>
      </div>
      <div className="flex justify-center py-2.5">
        <span className="rounded-full bg-signal px-3 py-1 text-xs font-semibold text-signal-fg">Show 3 new posts</span>
      </div>
    </div>
  );
}

export function ProfileArt() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel" aria-hidden="true">
      <div className={`h-8 ${s.cover}`} />
      <div className="flex items-end justify-between px-3 pb-3">
        <span className="-mt-4 rounded-lg bg-panel p-0.5">
          <Face name="Ana" size={36} />
        </span>
        <span className="rounded-full bg-signal px-3 py-1 text-xs font-semibold text-signal-fg">Follow</span>
      </div>
      <div className="px-3 pb-3 text-xs leading-tight">
        <div className="text-sm font-semibold">Ana</div>
        <div className="text-muted">@ana · 212 followers</div>
      </div>
    </div>
  );
}

export function CommunityPostArt() {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-sm" aria-hidden="true">
      <div className="mb-1 ml-9 flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded text-[7px] font-bold text-fg ${s.tile}`}>S</span>
        Studio
      </div>
      <div className="flex gap-2.5">
        <Face name="Sam" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <span className="font-semibold">Sam</span> <span className="text-muted">@sam · 5m</span>
          </div>
          <div className="text-[13px]">The new board view is in #design.</div>
          <div className="mt-1.5 flex gap-5 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <ReplyIcon className="h-3.5 w-3.5" /> 3
            </span>
            <span className="inline-flex items-center gap-1 text-fg">
              <HeartIcon className="h-3.5 w-3.5 fill-current" /> 12
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ListsArt() {
  return (
    <div className="space-y-1.5" aria-hidden="true">
      {[
        { n: "Jo", rel: "Follow back", on: true },
        { n: "Lee", rel: "Following" },
        { n: "Mia", rel: "Requested" },
      ].map((r) => (
        <div key={r.n} className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs">
          <Face name={r.n} size={22} />
          <span className="flex-1 font-medium">{r.n}</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${r.on ? "bg-signal text-signal-fg" : "border border-line"}`}>{r.rel}</span>
        </div>
      ))}
    </div>
  );
}

export function MediaArt() {
  return (
    <div className="grid grid-cols-[1fr_1fr_1.3fr] gap-1.5" aria-hidden="true">
      <span className={`flex aspect-square items-center justify-center rounded-md ${s.tile}`}>
        <ImageIcon className="h-4 w-4 text-muted" />
      </span>
      <span className={`aspect-square rounded-md ${s.cover} border border-line`} />
      <span className="flex flex-col justify-end overflow-hidden rounded-md border border-line bg-panel">
        <span className={`h-1/2 ${s.cover}`} />
        <span className="px-1.5 py-1 text-[10px] leading-tight">
          <span className="block text-muted">example.com</span>
          <span className="block font-medium">Link preview</span>
        </span>
      </span>
    </div>
  );
}
