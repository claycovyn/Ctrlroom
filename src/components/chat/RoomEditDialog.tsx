"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { byPosition, nextPosition, POST_ROLE_LABEL } from "@/lib/rooms";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Role, Room } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import { CloseIcon } from "./icons";

/**
 * Edit a room (owners and admins; the rooms_update policy decides). The slug never changes, so links keep working.
 * Text and voice rooms differ only in whether the call bar opens when you walk in, so the type is safe to switch.
 */
export function RoomEditDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const { rooms, setRooms, sections } = useCommunity();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(room.name);
  const [topic, setTopic] = useState(room.topic);
  const [description, setDescription] = useState(room.description ?? "");
  const [kind, setKind] = useState<Room["kind"]>(room.kind);
  const [postMin, setPostMin] = useState<Role>(room.post_min_role);
  const [sectionId, setSectionId] = useState(room.section_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the room a name.");
    setSaving(true);
    setError(null);
    const section = sectionId || null;
    const patch: Partial<Room> = {
      name: name.trim(),
      topic: topic.trim(),
      description: description.trim(),
      kind,
      post_min_role: postMin,
      section_id: section,
    };
    // Moving to another section puts the room at the end of it.
    if (section !== (room.section_id ?? null)) {
      patch.position = nextPosition(rooms.filter((r) => r.id !== room.id && (r.section_id ?? null) === section));
    }
    const { data, error: err } = await supabaseBrowser().from("rooms").update(patch).eq("id", room.id).select().maybeSingle();
    setSaving(false);
    if (err || !data) return setError(cloudErrorText(err?.message) ?? "Couldn't save the room. Only owners and admins can edit rooms.");
    setRooms((list) => list.map((r) => (r.id === room.id ? (data as Room) : r)).sort(byPosition));
    router.refresh();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="room-edit-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-0 text-fg backdrop:bg-black/60"
    >
      <form onSubmit={save} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 id="room-edit-title" className="min-w-0 truncate font-semibold">
            Edit #{room.slug}
          </h2>
          <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label className="label" htmlFor="room-name">
              Name
            </label>
            <input id="room-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} required />
            <p className="mt-1 text-xs text-muted">The link stays /{room.slug}.</p>
          </div>
          <div>
            <label className="label" htmlFor="room-topic">
              Topic
            </label>
            <input id="room-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={280} placeholder="One line, shown in the header" />
          </div>
          <div>
            <label className="label" htmlFor="room-description">
              Description
            </label>
            <textarea
              id="room-description"
              className="input min-h-28 resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="What the room is for, links, rules. Shown in the room info."
            />
            <p className="mt-1 text-right text-xs text-muted">{description.length}/1000</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="room-kind">
                Type
              </label>
              <select id="room-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Room["kind"])}>
                <option value="text">Text</option>
                <option value="voice">Voice (opens the call bar)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="room-post">
                Who can start posts
              </label>
              <select id="room-post" className="input" value={postMin} onChange={(e) => setPostMin(e.target.value as Role)}>
                {(["member", "mod", "admin", "owner"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {POST_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {sections.length > 0 && (
            <div>
              <label className="label" htmlFor="room-section">
                Section
              </label>
              <select id="room-section" className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">No section</option>
                {[...sections].sort(byPosition).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-muted">Everyone can still reply in threads. Change the order in Settings → Rooms.</p>
          {error && (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
