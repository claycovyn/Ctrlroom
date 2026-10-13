"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm, usePrompt } from "@/components/Dialogs";
import { cloudErrorText } from "@/lib/cloudErrors";
import { slugify } from "@/lib/format";
import { applyChange, applyPositions, byPosition, moveInList, nextPosition, POST_ROLE_LABEL } from "@/lib/rooms";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Room, RoomSection } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import { suggestRoomIcon } from "@/lib/roomIcons";
import { ArrowDownIcon, ArrowUpIcon, EditIcon, TrashIcon } from "./icons";
import { RoomIcon } from "./RoomIcon";
import { RoomIconPicker } from "./RoomIconPicker";
import { RoomEditDialog } from "./RoomEditDialog";

/** Settings → Rooms (owners and admins): add, edit, order, group into sections, delete. */
export function RoomsSettings({ say }: { say: (msg: string, bad?: boolean) => void }) {
  const { community, rooms, setRooms, sections, setSections } = useCommunity();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();
  const [editing, setEditing] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);

  // ── new room
  const [roomName, setRoomName] = useState("");
  const [roomKind, setRoomKind] = useState<Room["kind"]>("text");
  const [roomTopic, setRoomTopic] = useState("");
  const [roomSection, setRoomSection] = useState("");
  const [announce, setAnnounce] = useState(false);
  // The icon follows the name (suggestRoomIcon) until someone picks one; undefined = not picked yet.
  const [pickedIcon, setPickedIcon] = useState<string | null | undefined>(undefined);
  const roomIcon = pickedIcon === undefined ? suggestRoomIcon(roomName) : pickedIcon;
  // ── new section
  const [sectionName, setSectionName] = useState("");

  const orderedSections = [...sections].sort(byPosition);
  const known = new Set(sections.map((s) => s.id));
  const groupOf = (r: Room) => (r.section_id && known.has(r.section_id) ? r.section_id : null);
  const groups: { section: RoomSection | null; rooms: Room[] }[] = [
    { section: null, rooms: rooms.filter((r) => groupOf(r) === null).sort(byPosition) },
    ...orderedSections.map((s) => ({ section: s, rooms: rooms.filter((r) => groupOf(r) === s.id).sort(byPosition) })),
  ];

  /** Saves new positions; the list updates first and goes back to the server's on failure. */
  const savePositions = async (table: "rooms" | "room_sections", changes: { id: string; position: number }[]) => {
    if (!changes.length || busy) return;
    setBusy(true);
    if (table === "rooms") setRooms((list) => applyPositions(list, changes).sort(byPosition));
    else setSections((list) => applyPositions(list, changes).sort(byPosition));
    const results = await Promise.all(changes.map((c) => supabase.from(table).update({ position: c.position }).eq("id", c.id)));
    setBusy(false);
    if (results.some((r) => r.error)) say("Couldn't save the new order.", true);
    router.refresh();
  };

  const moveToSection = async (room: Room, sectionId: string) => {
    const section = sectionId || null;
    const position = nextPosition(rooms.filter((r) => r.id !== room.id && groupOf(r) === section));
    const { data, error } = await supabase.from("rooms").update({ section_id: section, position }).eq("id", room.id).select().maybeSingle();
    if (error || !data) return say(cloudErrorText(error?.message) ?? "Couldn't move the room.", true);
    setRooms((list) => applyChange(list, "update", data as Room));
    router.refresh();
  };

  return (
    <section id="rooms" className="card p-5">
      <h2 className="font-medium">Rooms</h2>
      <p className="mb-4 text-sm text-muted">Text rooms for chat. Voice rooms open a call when you walk in.</p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem]"
        onSubmit={async (e) => {
          e.preventDefault();
          const slug = slugify(roomName, 32);
          if (!slug) return say("Give the room a name.", true);
          const section = roomSection || null;
          const { data, error: err } = await supabase
            .from("rooms")
            .insert({
              community_id: community.id,
              slug,
              name: slug,
              topic: roomTopic.trim(),
              kind: roomKind,
              post_min_role: announce ? "mod" : "member",
              section_id: section,
              icon: roomIcon,
              position: nextPosition(rooms.filter((r) => groupOf(r) === section)),
            })
            .select()
            .single();
          if (err) return say(err.code === "23505" ? `#${slug} already exists.` : (cloudErrorText(err.message) ?? "Couldn't add the room."), true);
          setRooms((list) => applyChange(list, "insert", data as Room));
          setRoomName("");
          setRoomTopic("");
          setAnnounce(false);
          setPickedIcon(undefined);
          say(`#${slug} added.`);
          router.refresh();
        }}
      >
        <input className="input" placeholder="room-name" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={32} required aria-label="Room name" />
        <select className="input" value={roomKind} onChange={(e) => setRoomKind(e.target.value as Room["kind"])} aria-label="Room type">
          <option value="text">Text</option>
          <option value="voice">Voice</option>
        </select>
        <input className="input sm:col-span-2" placeholder="Topic (optional)" value={roomTopic} onChange={(e) => setRoomTopic(e.target.value)} maxLength={280} aria-label="Topic" />
        {sections.length > 0 && (
          <select className="input sm:col-span-2" value={roomSection} onChange={(e) => setRoomSection(e.target.value)} aria-label="Section for the new room">
            <option value="">No section</option>
            {orderedSections.map((s) => (
              <option key={s.id} value={s.id}>
                In {s.name}
              </option>
            ))}
          </select>
        )}
        <div className="sm:col-span-2">
          <RoomIconPicker
            value={roomIcon}
            onChange={setPickedIcon}
            room={{ kind: roomKind, post_min_role: announce ? "mod" : "member" }}
            hint={pickedIcon === undefined && roomIcon ? "Picked from the name. Change it if you like." : undefined}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announcements only (mods post, everyone can reply in threads)
        </label>
        <button className="btn-primary sm:col-span-2 sm:justify-self-start">Add room</button>
      </form>

      <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">Sections</h3>
      <p className="mb-3 text-sm text-muted">Group rooms under headings in the sidebar. Deleting a section keeps its rooms.</p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = sectionName.trim();
          if (!name) return;
          const { data, error } = await supabase
            .from("room_sections")
            .insert({ community_id: community.id, name, position: nextPosition(sections) })
            .select("id, community_id, name, position")
            .single();
          if (error) return say("Couldn't add the section.", true);
          setSections((list) => applyChange(list, "insert", data as RoomSection));
          setSectionName("");
          say(`${name} added.`);
          router.refresh();
        }}
      >
        <input className="input" placeholder="Section name" value={sectionName} onChange={(e) => setSectionName(e.target.value)} maxLength={48} aria-label="New section name" />
        <button className="btn-outline shrink-0">Add section</button>
      </form>

      {groups.map(({ section, rooms: list }, gi) => {
        if (!section && !list.length && sections.length > 0) return null;
        return (
          <div key={section?.id ?? "none"} className="mt-4">
            <div className="mb-1 flex flex-wrap items-center gap-1">
              <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{section ? section.name : sections.length ? "No section" : "All rooms"}</h4>
              {section && (
                <>
                  <IconButton label={`Move ${section.name} up`} disabled={gi <= 1 || busy} onClick={() => savePositions("room_sections", moveInList(orderedSections, section.id, -1))}>
                    <ArrowUpIcon />
                  </IconButton>
                  <IconButton
                    label={`Move ${section.name} down`}
                    disabled={gi === groups.length - 1 || busy}
                    onClick={() => savePositions("room_sections", moveInList(orderedSections, section.id, 1))}
                  >
                    <ArrowDownIcon />
                  </IconButton>
                  <IconButton
                    label={`Rename ${section.name}`}
                    onClick={async () => {
                      const name = await promptDialog(renameSectionDialog(section.name));
                      if (!name || name === section.name) return;
                      const { error } = await supabase.from("room_sections").update({ name }).eq("id", section.id);
                      if (error) return say("Couldn't rename the section.", true);
                      setSections((l) => applyChange(l, "update", { ...section, name }));
                      router.refresh();
                    }}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    label={`Delete ${section.name}`}
                    danger
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Delete the ${section.name} section?`,
                        body: list.length
                          ? `Its ${list.length === 1 ? "room stays" : `${list.length} rooms stay`}, with no section.`
                          : "It has no rooms. Only the heading goes.",
                        confirmLabel: "Delete section",
                        tone: "danger",
                      });
                      if (!ok) return;
                      const { error } = await supabase.from("room_sections").delete().eq("id", section.id);
                      if (error) return say("Couldn't delete the section.", true);
                      setSections((l) => l.filter((s) => s.id !== section.id));
                      setRooms((l) => l.map((r) => (r.section_id === section.id ? { ...r, section_id: null } : r)));
                      router.refresh();
                    }}
                  >
                    <TrashIcon />
                  </IconButton>
                </>
              )}
            </div>
            {list.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">No rooms yet. Members don’t see empty sections.</p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {list.map((r, i) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="flex items-center gap-2">
                        <RoomIcon room={r} className="h-4 w-4 shrink-0 text-muted" />
                        <span className="truncate font-medium">{r.name}</span>
                        {r.post_min_role !== "member" && (
                          <span className="shrink-0 rounded bg-raised px-1.5 text-xs text-muted">{POST_ROLE_LABEL[r.post_min_role].toLowerCase()} post</span>
                        )}
                      </div>
                      {r.topic && <div className="truncate text-xs text-muted">{r.topic}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      {sections.length > 0 && (
                        <select
                          className="input w-32 py-1 text-xs"
                          value={groupOf(r) ?? ""}
                          onChange={(e) => moveToSection(r, e.target.value)}
                          aria-label={`Move ${r.name} to section`}
                        >
                          <option value="">No section</option>
                          {orderedSections.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <IconButton label={`Move ${r.name} up`} disabled={i === 0 || busy} onClick={() => savePositions("rooms", moveInList(list, r.id, -1))}>
                        <ArrowUpIcon />
                      </IconButton>
                      <IconButton label={`Move ${r.name} down`} disabled={i === list.length - 1 || busy} onClick={() => savePositions("rooms", moveInList(list, r.id, 1))}>
                        <ArrowDownIcon />
                      </IconButton>
                      <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        label={`Delete ${r.name}`}
                        danger
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: `Delete #${r.name}?`,
                            body: "Every message, thread and board item in it is deleted too. This can’t be undone.",
                            confirmLabel: "Delete room",
                            tone: "danger",
                          });
                          if (!ok) return;
                          const { error: err } = await supabase.from("rooms").delete().eq("id", r.id);
                          if (err) return say("Couldn't delete the room.", true);
                          setRooms((l) => l.filter((x) => x.id !== r.id));
                          router.refresh();
                        }}
                      >
                        <TrashIcon />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {editing && (
        <RoomEditDialog
          room={rooms.find((r) => r.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** Settings → Rooms and the sidebar's section menu rename a section with the same dialog. */
export function renameSectionDialog(current: string) {
  return {
    title: `Rename ${current}`,
    label: "Section name",
    defaultValue: current,
    maxLength: 48,
    confirmLabel: "Rename",
  };
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`rounded p-1.5 text-muted hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent ${danger ? "hover:text-alert" : "hover:text-fg"}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
