"use client";

import { useId, useRef, useState } from "react";
import { roomIconById, searchRoomIcons, type RoomIconDef } from "@/lib/roomIcons";
import type { Room } from "@/lib/types";
import { RoomIcon, RoomIconSvg } from "./RoomIcon";

type Option = { id: string | null; label: string; icon: RoomIconDef | null };

/**
 * Pick a room's icon: a preview with Change, which opens a searchable grid (Default first). The grid is a radio
 * group with one tab stop: arrow keys move and choose, Home/End jump, and typing in the search box filters by label.
 */
export function RoomIconPicker({
  value,
  onChange,
  room,
  defaultOpen = false,
  hint,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Used to draw the Default option (# / speaker / megaphone). */
  room: Pick<Room, "kind" | "post_min_role">;
  defaultOpen?: boolean;
  hint?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const current = roomIconById(value);

  const q = query.trim();
  const options: Option[] = [
    ...(q && !"default".includes(q.toLowerCase()) ? [] : [{ id: null, label: "Default", icon: null }]),
    ...searchRoomIcons(q).map((i) => ({ id: i.id, label: i.label, icon: i })),
  ];
  const selected = options.findIndex((o) => o.id === (current ? current.id : null));
  const tabStop = selected >= 0 ? selected : 0;

  const focusAt = (i: number) => {
    const el = grid.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[i];
    el?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.id);
    focusAt(i);
  };
  const columns = () => {
    const el = grid.current;
    if (!el) return 1;
    return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
  };

  const onGridKey = (e: React.KeyboardEvent, i: number) => {
    const cols = columns();
    const last = options.length - 1;
    const move: Record<string, number> = {
      ArrowRight: Math.min(last, i + 1),
      ArrowLeft: Math.max(0, i - 1),
      ArrowDown: Math.min(last, i + cols),
      ArrowUp: i - cols < 0 ? -1 : i - cols,
      Home: 0,
      End: last,
    };
    if (!(e.key in move)) return;
    e.preventDefault();
    if (move[e.key] === -1) return document.getElementById(`${uid}-search`)?.focus();
    choose(move[e.key]);
  };

  return (
    <div>
      <span className="label" id={`${uid}-label`}>
        Icon
      </span>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised">
          <RoomIcon room={{ ...room, icon: value }} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{current ? current.label : "Default"}</span>
        <button
          type="button"
          className="btn-outline py-1 text-sm"
          aria-expanded={open}
          aria-controls={`${uid}-panel`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Done" : "Change"}
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {open && (
        <div id={`${uid}-panel`} className="mt-2 rounded-lg border border-line p-2">
          <input
            id={`${uid}-search`}
            type="search"
            className="input mb-2 py-1.5 text-sm"
            placeholder="Search icons"
            aria-label="Search icons"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                focusAt(tabStop);
              } else if (e.key === "Enter") {
                // Enter picks the first match instead of submitting the room form.
                e.preventDefault();
                if (options.length) choose(options[0].id === null && options.length > 1 && q ? 1 : 0);
              }
            }}
          />
          {options.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted">No icons match “{q}”.</p>
          ) : (
            <div
              ref={grid}
              role="radiogroup"
              aria-labelledby={`${uid}-label`}
              className="scroll-thin grid max-h-56 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 overflow-y-auto"
            >
              {options.map((o, i) => {
                const on = i === selected;
                return (
                  <button
                    key={o.id ?? "default"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={o.label}
                    title={o.label}
                    tabIndex={i === tabStop ? 0 : -1}
                    onClick={() => choose(i)}
                    onKeyDown={(e) => onGridKey(e, i)}
                    className={`flex h-10 items-center justify-center rounded-md border text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal ${
                      on ? "border-signal bg-raised" : "border-transparent hover:bg-raised"
                    }`}
                  >
                    {o.icon ? <RoomIconSvg icon={o.icon} className="h-5 w-5" /> : <RoomIcon room={room} className="h-5 w-5 text-muted" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
