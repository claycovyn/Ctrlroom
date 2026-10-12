"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { sinceLabel } from "@/lib/format";
import type { AppNotification } from "@/lib/types";
import { useCommunity } from "./CommunityContext";
import { BellIcon } from "./icons";

const VERB: Record<AppNotification["kind"], string> = {
  comment: "commented on your post",
  reply: "replied to your comment",
  mention: "mentioned you",
  answer: "picked your comment as the answer",
};

export function NotificationBell({ items, onOpen }: { items: AppNotification[]; onOpen: () => void }) {
  const { community, profiles } = useCommunity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="relative rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) onOpen();
        }}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-bold text-signal-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Nothing yet. Comments on your posts, replies and @mentions show up here.
            </p>
          ) : (
            <ul className="scroll-thin max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/c/${community.slug}/feed/${n.post_id}${n.comment_id ? `#c-${n.comment_id}` : ""}`}
                    className={`block px-4 py-2.5 text-sm hover:bg-raised ${n.read_at ? "" : "bg-signal/5"}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="font-medium">{n.actor ?? (n.actor_id && profiles[n.actor_id]?.display_name) ?? "Someone"}</span>{" "}
                    <span className="text-muted">{VERB[n.kind]}</span>
                    {n.preview && <span className="mt-0.5 block truncate text-muted">“{n.preview}”</span>}
                    <span className="mt-0.5 block text-xs text-muted">{sinceLabel(n.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
