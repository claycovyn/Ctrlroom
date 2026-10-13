"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ModalSheet, SheetActions } from "@/components/Dialogs";
import { Avatar } from "@/components/chat/Avatar";
import { CheckIcon, CloseIcon } from "@/components/chat/icons";
import { cloudErrorText } from "@/lib/cloudErrors";
import { MAX_GROUP, togglePick, type DmPerson } from "@/lib/dms";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * "New message" (pick 1–9 people, write the first message; two or more make a group) and a group's "Add people"
 * (`addTo`: no message, only as many as still fit). Search is dm_search_people (0011): people you share a community
 * with, plus an exact username for people who take messages from anyone.
 */
export function NewMessageDialog({
  onClose,
  onStarted,
  addTo,
  initial = [],
}: {
  onClose: () => void;
  /** New conversation: its id. */
  onStarted?: (conversationId: string) => void;
  /** Adding to a group: its id, who's in it already and how many more fit. */
  addTo?: { conversationId: string; memberIds: string[]; room: number; onAdded: () => void };
  initial?: DmPerson[];
}) {
  const uid = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DmPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<DmPerson[]>(initial);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = addTo ? addTo.room : MAX_GROUP - 1;
  const exclude = addTo?.memberIds.join(",") ?? "";

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("dm_search_people", { p_query: query });
      if (cancelled) return;
      setResults(((data ?? []) as DmPerson[]).filter((p) => !exclude.split(",").includes(p.id)));
      setSearching(false);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, exclude]);

  const toggle = (p: DmPerson) => {
    const { selected, full } = togglePick(
      picked.map((x) => x.id),
      p.id,
      limit,
    );
    if (full) return setError(addTo ? `This group has room for ${limit} more.` : `A group can have up to ${MAX_GROUP} people.`);
    setError(null);
    setPicked(selected.map((id) => picked.find((x) => x.id === id) ?? p));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!picked.length) return setError("Pick someone first.");
    if (!addTo && !body.trim()) return setError("Write a message first.");
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    if (addTo) {
      const { error: err } = await supabase.rpc("add_to_group", { p_conv: addTo.conversationId, p_user_ids: picked.map((p) => p.id) });
      setBusy(false);
      if (err) return setError(cloudErrorText(err.message) ?? "Couldn't add them. Try again.");
      addTo.onAdded();
      return onClose();
    }
    const { data, error: err } = await supabase.rpc("start_dm", {
      p_user_ids: picked.map((p) => p.id),
      p_body: body.trim(),
      p_title: picked.length > 1 ? title.trim() || null : null,
    });
    setBusy(false);
    if (err || !data) return setError(cloudErrorText(err?.message) ?? "Message didn't send. Try again.");
    onStarted?.(data as string);
  };

  const group = picked.length > 1;

  return (
    <ModalSheet onCancel={onClose} labelledBy={`${uid}-title`} initialFocus={searchRef}>
      <form onSubmit={submit} noValidate className="cr-sheet-body">
        <div className="shrink-0 px-5 pt-5">
          <h2 id={`${uid}-title`} className="text-base font-semibold">
            {addTo ? "Add people" : "New message"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {addTo ? `Up to ${limit} more.` : `One person, or up to ${MAX_GROUP - 1} for a group.`} People who haven&apos;t talked with you get it as a
            request.
          </p>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-3">
          <div>
            <label className="label" htmlFor={`${uid}-to`}>
              To
            </label>
            {picked.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Picked">
                {picked.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pl-1 pr-2 text-sm hover:border-muted"
                      onClick={() => toggle(p)}
                      aria-label={`Remove ${p.display_name}`}
                    >
                      <Avatar profile={{ ...p, is_bot: false }} size={20} />
                      {p.display_name}
                      <CloseIcon className="h-3 w-3 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={searchRef}
              id={`${uid}-to`}
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or @username"
              autoComplete="off"
              aria-describedby={`${uid}-to-note`}
            />
            <p id={`${uid}-to-note`} className="mt-1 text-xs text-muted">
              People in your communities. Others only by their exact username, if they take messages from anyone.
            </p>
          </div>
          <ul className="-mx-2 space-y-0.5" aria-label="People" aria-busy={searching}>
            {results.map((p) => {
              const on = picked.some((x) => x.id === p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => toggle(p)}
                    disabled={!p.can_message && !on}
                    aria-pressed={on}
                  >
                    <Avatar profile={{ ...p, is_bot: false }} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.display_name}</span>
                      <span className="block truncate text-xs text-muted">
                        @{p.username}
                        {!p.can_message && " · Not taking messages"}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-signal bg-signal text-signal-fg" : "border-line"}`}
                    >
                      {on && <CheckIcon className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
            {!searching && results.length === 0 && <li className="px-2 py-2 text-sm text-muted">{query ? "Nobody found." : "Nobody to show yet."}</li>}
          </ul>
          {!addTo && group && (
            <div>
              <label className="label" htmlFor={`${uid}-title-input`}>
                Group name (optional)
              </label>
              <input id={`${uid}-title-input`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} autoComplete="off" />
            </div>
          )}
          {!addTo && (
            <div>
              <label className="label" htmlFor={`${uid}-body`}>
                Message
              </label>
              <textarea
                id={`${uid}-body`}
                className="input min-h-[4.5rem]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          )}
        </div>
        <SheetActions>
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {addTo ? (busy ? "Adding…" : "Add") : busy ? "Sending…" : group ? "Start group" : "Send"}
          </button>
        </SheetActions>
      </form>
    </ModalSheet>
  );
}
