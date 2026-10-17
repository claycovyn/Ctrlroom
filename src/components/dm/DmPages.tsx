"use client";
import { useRouter } from "next/navigation";

import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { ChatsIcon } from "@/components/chat/icons";
import { PushPrompt } from "@/components/push/PushPrompt";
import type { Profile } from "@/lib/types";
import { DmConversationView } from "./DmConversationView";
import { DmProvider } from "./DmContext";
import { MobileTabBar, useTabBadges } from "@/components/shell/MobileTabBar";
import { DmInbox } from "./DmInbox";

/** /dm: the inbox. Full width on phones; a list and an empty pane from 1024px. */
export function DmInboxPage() {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col lg:w-80 lg:flex-none lg:border-r lg:border-line">
        <DmInbox />
      </div>
      <div className="hidden flex-1 items-center justify-center p-8 text-center lg:flex">
        <div className="max-w-xs">
          <ChatsIcon className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 font-medium">Pick a conversation</p>
          <p className="mt-1 text-sm text-muted">Or start one with New message. Direct messages are only seen by the people in them.</p>
        </div>
      </div>
    </div>
  );
}

/** /dm/<id>: the conversation, with the list beside it from 1024px. */
export function DmConversationPage({ id }: { id: string }) {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="hidden w-80 shrink-0 flex-col border-r border-line lg:flex">
        <DmInbox compact />
      </div>
      <DmConversationView key={id} id={id} />
    </div>
  );
}

/** /app/dm for someone who isn't in any community yet (inside a community the DMs live under /c/<slug>/dm). */
export function StandaloneDm({ me, id }: { me: Profile; id: string | null }) {
  const router = useRouter();
  const { dms, activity } = useTabBadges(me);
  return (
    <DmProvider me={me} base="/app/dm" listen>
      <div className="cr-shell cr-safe-top flex flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-sm">
          <Link href="/app" className="flex items-center gap-2 text-muted hover:text-fg">
            <LogoMark className="h-6 w-6" />
            Home
          </Link>
        </div>
        <main className={`flex min-h-0 flex-1 ${id ? "" : "cr-has-tabbar"}`}>{id ? <DmConversationPage id={id} /> : <DmInboxPage />}</main>
        {/* The shared bar stays on the inbox; a conversation hides it (its composer owns the bottom). */}
        <MobileTabBar me={me} dms={dms} activity={activity} onCompose={() => router.push("/app?compose=post")} show={!id} />
        <PushPrompt />
      </div>
    </DmProvider>
  );
}
