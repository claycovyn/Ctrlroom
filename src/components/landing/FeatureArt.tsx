import { RoomIconSvg } from "@/components/chat/RoomIcon";
import { CheckIcon, PhoneIcon, PinIcon, ThreadIcon } from "@/components/chat/icons";
import { ROOM_ICONS, roomIconById, type RoomIconId } from "@/lib/roomIcons";
import s from "./landing.module.css";

// Small drawings for the feature cards. Decorative: each card's heading and text say the same thing.

const chip = "inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm";

export function IconsArt() {
  const ids: RoomIconId[] = ["general", "announcements", "voice", "dev", "design", "music", "gaming", "help", "ideas", "bugs", "photos", "books", "art", "food", "travel", "memes"];
  return (
    <div className="grid grid-cols-8 gap-1.5 text-fg" aria-hidden="true">
      {ids.map((id, i) => {
        const icon = roomIconById(id);
        return icon ? (
          <span key={id} className={`flex aspect-square items-center justify-center rounded-md ${i === 4 ? "bg-signal text-signal-fg" : s.tile}`}>
            <RoomIconSvg icon={icon} className="h-4 w-4" />
          </span>
        ) : null;
      })}
    </div>
  );
}

export const ROOM_ICON_COUNT = ROOM_ICONS.length;

export function OutcomeArt() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <span className="inline-flex items-center gap-1 rounded-full text-xs font-medium text-signal">
        <ThreadIcon className="h-3.5 w-3.5" /> 6 replies <span className="text-muted">· closed</span>
      </span>
      <div className="flex items-start gap-2 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
        <span>
          <span className="font-medium">Outcome:</span> Meetups move to the first Thursday.
        </span>
      </div>
    </div>
  );
}

export function BoardArt() {
  return (
    <div className="flex flex-wrap justify-center gap-2" aria-hidden="true">
      {["decision", "link", "doc", "note"].map((k, i) => (
        <span key={k} className={`${chip} ${i === 0 ? "border-signal/50" : ""}`}>
          {i === 0 && <PinIcon className="h-3 w-3" />}
          {k}
        </span>
      ))}
    </div>
  );
}

export function CallArt() {
  return (
    <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
      {["Sa", "An", "screen"].map((n) => (
        <span key={n} className={`flex aspect-video items-center justify-center rounded-md text-xs font-semibold ${s.tile}`}>
          {n === "screen" ? <span className="h-2/5 w-3/5 rounded-sm border border-fg/30" /> : n}
        </span>
      ))}
    </div>
  );
}

export function HelperArt() {
  return (
    <div className="space-y-2.5 text-sm" aria-hidden="true">
      <p>
        <span className="rounded bg-signal/15 px-1 py-0.5 font-medium">@ctrl</span> <span className="text-muted">summarize this thread</span>
      </p>
      <p className="inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full bg-signal ${s.pulse}`} />
        Ctrl · Writing the answer…
      </p>
    </div>
  );
}

export function ImagesArt() {
  return (
    <div className="flex items-end gap-3" aria-hidden="true">
      <span className={`block h-14 flex-1 rounded-md border border-line ${s.cover}`} />
      <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line">
        <span className={`absolute inset-0 ${s.tile}`} />
        <span className="absolute inset-2 rounded-full border border-dashed border-fg/40" />
      </span>
    </div>
  );
}

export function RequestArt() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs" aria-hidden="true">
      <span className={s.mockAvatar} style={{ width: 28, height: 28, fontSize: 10 }}>
        Jo
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Jo</span> <span className="text-muted">asked to join</span>
      </span>
      <span className="rounded-md bg-signal px-2 py-1 font-medium text-signal-fg">Approve</span>
      <span className="rounded-md border border-line px-2 py-1">Decline</span>
    </div>
  );
}

export { PhoneIcon };
