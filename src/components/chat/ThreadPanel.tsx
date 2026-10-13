"use client";

import { useState } from "react";
import { buildRows, summarizeReactions } from "@/lib/format";
import { atLeast, type Message, type Reaction } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import type { OutgoingAttachment } from "./attachments/useAttachmentDrafts";
import { Composer } from "./Composer";
import { MessageItem, type MessageActions } from "./MessageItem";
import { Panel } from "./Panel";

export function ThreadPanel({
  root,
  replies,
  reactions,
  loading,
  actions,
  onClose,
  onReply,
  agentStatus,
  onResolve,
  onReopen,
}: {
  root: Message;
  replies: Message[];
  reactions: Reaction[];
  loading: boolean;
  actions: MessageActions;
  onClose: () => void;
  onReply: (body: string, attachments: OutgoingAttachment[]) => Promise<boolean>;
  agentStatus?: string | null;
  onResolve: (outcome: string, pin: boolean) => Promise<boolean>;
  onReopen: () => void;
}) {
  const { me, role, community, profiles } = useCommunity();
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [pin, setPin] = useState(true);
  const summary = summarizeReactions(reactions, me.id);
  const canResolve = root.author_id === me.id || atLeast(role, "mod");
  const canModerate = atLeast(role, "mod");

  return (
    <Panel
      title="Thread"
      onClose={onClose}
      footer={
        root.deleted_at ? null : (
          <div className="border-t border-line pt-2">
            <p className="h-5 truncate px-5 text-xs" aria-live="polite">
              {agentStatus && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
                  {agentStatus}
                </span>
              )}
            </p>
            <Composer
              placeholder="Reply… (@ctrl to ask AI)"
              communityId={community.id}
              onSend={onReply}
              attach={{ kind: "room", roomId: root.room_id }}
              autoFocus
            />
          </div>
        )
      }
    >
      <div className="border-b border-line pb-3">
        <MessageItem
          message={root}
          author={profiles[root.author_id]}
          compact={false}
          reactions={summary.get(root.id)}
          me={me}
          canModerate={canModerate}
          actions={{ ...actions, openThread: undefined }}
        />
        {canResolve && !root.deleted_at && (
          <div className="px-4 pt-2">
            {root.resolved_at ? (
              <button className="text-xs text-muted hover:text-fg" onClick={onReopen}>
                Reopen thread
              </button>
            ) : closing ? (
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await onResolve(outcome, pin)) {
                    setClosing(false);
                    setOutcome("");
                  }
                }}
              >
                <label className="label" htmlFor="outcome">
                  What was decided?
                </label>
                <textarea id="outcome" className="input min-h-[64px]" maxLength={500} value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus required />
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin it to the room board
                </label>
                <div className="flex gap-2">
                  <button className="btn-primary py-1.5 text-xs">Close thread</button>
                  <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setClosing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button className="btn-outline py-1.5 text-xs" onClick={() => setClosing(true)}>
                Close with an outcome
              </button>
            )}
          </div>
        )}
      </div>
      <div className="py-2">
        {loading ? (
          <p className="px-4 py-3 text-sm text-muted">Loading replies…</p>
        ) : replies.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No replies yet. Start the thread.</p>
        ) : (
          buildRows(replies).map(({ message, compact }) => (
            <MessageItem
              key={message.id}
              message={message}
              author={profiles[message.author_id]}
              compact={compact}
              reactions={summary.get(message.id)}
              me={me}
              canModerate={canModerate}
              actions={{ ...actions, openThread: undefined }}
            />
          ))
        )}
      </div>
    </Panel>
  );
}
