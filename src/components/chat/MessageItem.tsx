"use client";

import { useState } from "react";
import { useConfirm } from "@/components/Dialogs";
import { timeLabel } from "@/lib/format";
import type { ReactionSummary } from "@/lib/format";
import type { Message, Profile } from "@/lib/types";
import { PresenceAvatar } from "./PresenceAvatar";
import { BlockIcon, CheckIcon, EditIcon, FlagIcon, PinIcon, SmileIcon, ThreadIcon, TrashIcon } from "./icons";
import { RichText } from "./RichText";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "✅"];

export interface MessageActions {
  react: (m: Message, emoji: string) => void;
  openThread?: (m: Message) => void;
  /** Pin to the room board (rooms only). */
  pin?: (m: Message) => void;
  edit: (m: Message, body: string) => Promise<boolean>;
  remove: (m: Message) => void;
  /** Report someone else's message to the operator. */
  report?: (m: Message) => void;
  /** Block the author (direct messages). */
  block?: (m: Message) => void;
}

export function MessageItem({
  message: m,
  author,
  compact,
  reactions,
  me,
  canModerate,
  highlight,
  actions,
}: {
  message: Message;
  author: Profile | undefined;
  compact: boolean;
  reactions: ReactionSummary[] | undefined;
  me: Profile;
  canModerate: boolean;
  highlight?: boolean;
  actions: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [picker, setPicker] = useState(false);
  const confirmDialog = useConfirm();
  const mine = m.author_id === me.id;

  if (m.deleted_at) {
    return (
      <div id={`m-${m.id}`} className="px-4 py-1 pl-[60px] text-sm italic text-muted">
        Message removed
        {m.reply_count > 0 && actions.openThread && (
          <button className="ml-2 not-italic text-signal hover:underline" onClick={() => actions.openThread!(m)}>
            {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>
    );
  }

  const save = async () => {
    const body = draft.trim();
    if (!body || body === m.body) return setEditing(false);
    if (await actions.edit(m, body)) setEditing(false);
  };

  return (
    <div
      id={`m-${m.id}`}
      className={`group relative flex gap-3 px-4 ${compact ? "py-0.5" : "pt-3 pb-0.5"} hover:bg-raised/50 ${
        highlight ? "bg-signal/10" : ""
      }`}
    >
      <div className="w-9 shrink-0">
        {compact ? (
          <span className="invisible block pt-1 text-right text-[10px] text-muted group-hover:visible">
            {timeLabel(m.created_at)}
          </span>
        ) : (
          <PresenceAvatar profile={author} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{author?.display_name ?? "…"}</span>
            {author?.is_bot && <span className="rounded bg-signal px-1 text-[10px] font-bold uppercase leading-4 text-signal-fg">AI</span>}
            <span className="text-xs text-muted">{timeLabel(m.created_at)}</span>
          </div>
        )}
        {editing ? (
          <div className="mt-1">
            <textarea
              className="input min-h-[60px] resize-y"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <p className="mt-1 text-xs text-muted">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            <RichText body={m.body} myUsername={me.username} />
            {m.edited_at && <span className="ml-1 text-xs text-muted">(edited)</span>}
          </div>
        )}

        {m.outcome && (
          <div className="mt-1.5 flex items-start gap-2 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <span>
              <span className="font-medium">Outcome:</span> {m.outcome}
            </span>
          </div>
        )}

        {(reactions?.length || m.reply_count > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {reactions?.map((r) => (
              <button
                key={r.emoji}
                onClick={() => actions.react(m, r.emoji)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  r.mine ? "border-signal/60 bg-signal/15" : "border-line bg-raised hover:border-muted"
                }`}
                aria-pressed={r.mine}
              >
                {r.emoji} {r.count}
              </button>
            ))}
            {m.reply_count > 0 && actions.openThread && (
              <button
                onClick={() => actions.openThread!(m)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-signal hover:bg-raised"
              >
                <ThreadIcon className="h-3.5 w-3.5" />
                {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
                {m.resolved_at && <span className="text-muted">· closed</span>}
              </button>
            )}
          </div>
        )}
      </div>

      {!editing && (
        <div className="absolute -top-3 right-4 hidden items-center rounded-md border border-line bg-panel shadow-sm group-focus-within:flex group-hover:flex">
          {picker ? (
            QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                className="px-1.5 py-1 text-base hover:bg-raised"
                onClick={() => {
                  actions.react(m, e);
                  setPicker(false);
                }}
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))
          ) : (
            <>
              <ToolButton label="React" onClick={() => setPicker(true)}>
                <SmileIcon />
              </ToolButton>
              {actions.openThread && (
                <ToolButton label="Reply in thread" onClick={() => actions.openThread!(m)}>
                  <ThreadIcon />
                </ToolButton>
              )}
              {actions.pin && (
                <ToolButton label="Pin to board" onClick={() => actions.pin!(m)}>
                  <PinIcon />
                </ToolButton>
              )}
              {mine && (
                <ToolButton
                  label="Edit"
                  onClick={() => {
                    setDraft(m.body);
                    setEditing(true);
                  }}
                >
                  <EditIcon />
                </ToolButton>
              )}
              {(mine || canModerate) && (
                <ToolButton
                  label="Delete"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: mine ? "Delete your message?" : `Delete ${author?.display_name ?? "this person"}’s message?`,
                      body:
                        "It shows as “Message removed” for everyone and its reactions are cleared." +
                        (m.reply_count > 0 ? ` The ${m.reply_count === 1 ? "reply" : `${m.reply_count} replies`} in its thread stay.` : ""),
                      confirmLabel: "Delete",
                      tone: "danger",
                    });
                    if (ok) actions.remove(m);
                  }}
                >
                  <TrashIcon />
                </ToolButton>
              )}
              {!mine && actions.report && (
                <ToolButton label="Report" onClick={() => actions.report!(m)}>
                  <FlagIcon />
                </ToolButton>
              )}
              {!mine && actions.block && (
                <ToolButton label={`Block ${author?.display_name ?? "this person"}`} onClick={() => actions.block!(m)}>
                  <BlockIcon />
                </ToolButton>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="p-1.5 text-muted hover:bg-raised hover:text-fg" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}
