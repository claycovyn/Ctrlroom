"use client";

import { useCommunity } from "@/components/chat/CommunityContext";
import { MenuIcon } from "@/components/chat/icons";

export function PageHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  const { setNavOpen } = useCommunity();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
      <button className="rounded p-1.5 text-muted hover:bg-raised md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
        <MenuIcon className="h-5 w-5" />
      </button>
      <h1 className="truncate font-semibold">{title}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}

export function Page({ title, actions, children, wide }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title={title}>{actions}</PageHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto px-4 py-6 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</div>
      </div>
    </div>
  );
}
