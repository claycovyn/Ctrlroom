"use client";

import { useRef } from "react";
import { useSwipeDismiss } from "@/components/useSwipeDismiss";
import { CloseIcon } from "./icons";

export function Panel({ title, onClose, children, footer }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // Full screen on phones: slides in from the right (.cr-panel) and a drag to the right closes it.
  const ref = useRef<HTMLElement>(null);
  useSwipeDismiss({ target: ref, direction: "right", enabled: true, onDismiss: onClose, exitFirst: true });
  return (
    <aside ref={ref} className="cr-panel fixed inset-0 z-30 flex flex-col bg-panel md:static md:z-auto md:w-[24rem] md:shrink-0 md:border-l md:border-line">
      <div className="cr-chrome flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="min-w-0 truncate font-semibold">{title}</h2>
        <button className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg" onClick={onClose} aria-label="Close panel">
          <CloseIcon />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </aside>
  );
}
