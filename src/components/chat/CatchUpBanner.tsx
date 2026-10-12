"use client";

import { sinceLabel } from "@/lib/format";
import type { CatchUp } from "@/lib/types";
import { CloseIcon } from "./icons";

export function CatchUpBanner({
  data,
  onJump,
  onThread,
  onBoard,
  onDismiss,
}: {
  data: CatchUp;
  onJump: () => void;
  onThread: (id: string) => void;
  onBoard: () => void;
  onDismiss: () => void;
}) {
  const people =
    data.people.length <= 2 ? data.people.join(" and ") : `${data.people.slice(0, 2).join(", ")} and ${data.people.length - 2} more`;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-signal/40 bg-signal/10 px-4 py-3 text-sm" role="status">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium">
            While you were gone ({sinceLabel(data.since)}): {data.new_messages} new {data.new_messages === 1 ? "message" : "messages"}
            {people && <span className="font-normal text-muted"> from {people}</span>}
          </p>
          {data.mentions > 0 && (
            <p>
              You were mentioned or replied to {data.mentions === 1 ? "once" : `${data.mentions} times`}.
            </p>
          )}
          {data.threads.length > 0 && (
            <ul className="space-y-0.5">
              {data.threads.map((t) => (
                <li key={t.id}>
                  <button className="text-left hover:underline" onClick={() => onThread(t.id)}>
                    <span className="text-signal">Busy thread</span> ({t.new_replies} new): “{t.preview}”
                    {t.outcome && <span className="text-muted"> · closed: {t.outcome}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.decisions.length > 0 && (
            <p>
              <button className="text-left hover:underline" onClick={onBoard}>
                <span className="text-signal">Decided:</span> {data.decisions.map((d) => d.title).join(" · ")}
              </button>
            </p>
          )}
          {data.first_unread_id && (
            <button className="text-xs font-medium text-signal hover:underline" onClick={onJump}>
              Jump to first new message ↑
            </button>
          )}
        </div>
        <button className="rounded p-1 text-muted hover:text-fg" onClick={onDismiss} aria-label="Dismiss">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
