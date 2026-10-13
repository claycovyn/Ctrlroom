"use client";

import { useId, useRef, useState } from "react";
import { ModalSheet, SheetActions } from "@/components/Dialogs";
import { slugify } from "@/lib/format";
import { suggestRoomIcon } from "@/lib/roomIcons";
import type { Room, RoomSection } from "@/lib/types";
import { RoomIconPicker } from "./RoomIconPicker";

export interface NewRoom {
  slug: string;
  kind: Room["kind"];
  icon: string | null;
}

/**
 * The sidebar section menu's "Add a room here": name, icon (follows the name until picked, as in Settings → Rooms)
 * and text or voice. `onCreate` saves it and returns an error to show, or null when the room was added.
 */
export function AddRoomDialog({
  section,
  onCancel,
  onCreate,
}: {
  section: RoomSection;
  onCancel: () => void;
  onCreate: (room: NewRoom) => Promise<string | null>;
}) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Room["kind"]>("text");
  // undefined = not picked yet, so the suggestion keeps following the name.
  const [pickedIcon, setPickedIcon] = useState<string | null | undefined>(undefined);
  const icon = pickedIcon === undefined ? suggestRoomIcon(name) : pickedIcon;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const slug = slugify(name, 32);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!slug) {
      setError("Give the room a name.");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    const err = await onCreate({ slug, kind, icon });
    setSaving(false);
    if (err) {
      setError(err);
      nameRef.current?.focus();
    }
  };

  return (
    <ModalSheet onCancel={onCancel} labelledBy={`${uid}-title`} initialFocus={nameRef}>
      <form onSubmit={submit} noValidate className="cr-sheet-body">
        <div className="shrink-0 px-5 pt-5">
          <h2 id={`${uid}-title`} className="text-base font-semibold leading-snug [overflow-wrap:anywhere]">
            Add a room to {section.name}
          </h2>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-3">
          <div>
            <label className="label" htmlFor={`${uid}-name`}>
              Name
            </label>
            <input
              ref={nameRef}
              id={`${uid}-name`}
              className={`input ${error ? "border-alert focus:border-alert" : ""}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              maxLength={32}
              placeholder="room-name"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${uid}-name-note`}
            />
            {error ? (
              <p id={`${uid}-name-note`} role="alert" className="mt-1 text-xs text-alert">
                {error}
              </p>
            ) : (
              <p id={`${uid}-name-note`} className="mt-1 text-xs text-muted">
                {slug ? `The link will be /${slug}.` : "Lowercase letters, numbers and dashes."}
              </p>
            )}
          </div>
          <RoomIconPicker
            value={icon}
            onChange={setPickedIcon}
            room={{ kind, post_min_role: "member" }}
            hint={pickedIcon === undefined && icon ? "Picked from the name. Change it if you like." : undefined}
          />
          <fieldset>
            <legend className="label">Type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["text", "Text", "Messages and threads"],
                  ["voice", "Voice", "Opens the call bar"],
                ] as const
              ).map(([value, label, note]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${
                    kind === value ? "border-signal bg-raised" : "border-line hover:bg-raised"
                  }`}
                >
                  <input type="radio" name={`${uid}-kind`} value={value} checked={kind === value} onChange={() => setKind(value)} className="mt-0.5 accent-current" />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-muted">{note}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <SheetActions>
          <button type="button" className="btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Adding…" : "Add room"}
          </button>
        </SheetActions>
      </form>
    </ModalSheet>
  );
}
