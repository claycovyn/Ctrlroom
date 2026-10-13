"use client";

import { useState } from "react";
import { useConfirm } from "@/components/Dialogs";
import { sinceLabel } from "@/lib/format";
import { atLeast, type BoardItem } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import { Panel } from "./Panel";
import { TrashIcon } from "./icons";

const KINDS: { value: BoardItem["kind"]; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "link", label: "Link" },
  { value: "doc", label: "Doc" },
  { value: "note", label: "Note" },
];

export function BoardPanel({
  roomName,
  items,
  onClose,
  onAdd,
  onDelete,
  onJump,
}: {
  roomName: string;
  items: BoardItem[];
  onClose: () => void;
  onAdd: (item: Pick<BoardItem, "kind" | "title" | "url" | "body">) => Promise<boolean>;
  onDelete: (item: BoardItem) => void;
  onJump: (messageId: string) => void;
}) {
  const { me, role, profiles } = useCommunity();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<BoardItem["kind"]>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const confirmDialog = useConfirm();
  const [filter, setFilter] = useState<BoardItem["kind"] | "all">("all");
  const shown = items.filter((i) => filter === "all" || i.kind === filter);

  return (
    <Panel title={`Board · #${roomName}`} onClose={onClose}>
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">
        {(["all", ...KINDS.map((k) => k.value)] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-2.5 py-1 text-xs capitalize ${filter === k ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg"}`}
          >
            {k === "all" ? "Everything" : `${k}s`}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        {adding ? (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await onAdd({ kind, title: title.trim(), url: url.trim() || null, body: body.trim() });
              if (ok) {
                setAdding(false);
                setTitle("");
                setUrl("");
                setBody("");
              }
            }}
          >
            <div className="flex gap-1">
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={`rounded px-2 py-1 text-xs ${kind === k.value ? "bg-signal text-signal-fg" : "bg-raised text-muted"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required />
            {(kind === "link" || kind === "doc") && (
              <input className="input" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} pattern="https?://.+" />
            )}
            <textarea className="input min-h-[60px]" placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
            <div className="flex gap-2">
              <button className="btn-primary py-1.5 text-xs">Add to board</button>
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn-outline w-full text-xs" onClick={() => setAdding(true)}>
            Add a decision, link or doc
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          Nothing here yet. Pin a message, or close a thread with an outcome, and it shows up here.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((i) => (
            <li key={i.id} className="group px-4 py-3">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${i.kind === "decision" ? "bg-signal/20 text-signal" : "bg-raised text-muted"}`}>
                  {i.kind}
                </span>
                <div className="min-w-0 flex-1">
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium hover:underline">
                      {i.title}
                    </a>
                  ) : (
                    <p className="font-medium">{i.title}</p>
                  )}
                  {i.body && i.body !== i.title && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{i.body}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {profiles[i.created_by]?.display_name ?? "Someone"} · {sinceLabel(i.created_at)}
                    {i.message_id && (
                      <button className="ml-2 text-signal hover:underline" onClick={() => onJump(i.message_id!)}>
                        View message
                      </button>
                    )}
                  </p>
                </div>
                {(i.created_by === me.id || atLeast(role, "mod")) && (
                  <button
                    className="invisible rounded p-1 text-muted hover:text-alert group-hover:visible"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Remove “${i.title}” from the board?`,
                        body: i.message_id
                          ? `It’s removed from the #${roomName} board for everyone. The message it came from stays.`
                          : `It’s removed from the #${roomName} board for everyone.`,
                        confirmLabel: "Remove",
                        tone: "danger",
                      });
                      if (ok) onDelete(i);
                    }}
                    aria-label="Remove from board"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
