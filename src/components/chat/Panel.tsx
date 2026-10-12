"use client";

import { CloseIcon } from "./icons";

export function Panel({ title, onClose, children, footer }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-panel md:static md:z-auto md:w-[24rem] md:shrink-0 md:border-l md:border-line">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
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
