"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId } from "react";
import { CreateCommunityForm, JoinCommunityForm } from "@/app/app/HomeForms";
import { Avatar } from "@/components/chat/Avatar";
import { CloseIcon } from "@/components/chat/icons";
import { ModalSheet } from "@/components/Dialogs";
import { Composer } from "@/components/social/Composer";
import { PublicProfileSetup } from "@/components/social/PublicProfileSetup";
import { POSTED_EVENT } from "@/lib/shell";
import type { PostCard } from "@/lib/social";
import { useShell } from "./ShellContext";
import type { ShellSheet } from "./ShellContext";

function Head({ id, title, lead, onClose }: { id: string; title: string; lead?: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-start gap-3 px-5 pt-5">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-base font-semibold leading-snug">
          {title}
        </h2>
        {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
      </div>
      <button type="button" onClick={onClose} className="-mr-1.5 -mt-1 rounded-md p-1.5 text-muted hover:bg-raised hover:text-fg" aria-label="Close">
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

/** The shell's sheets: a new post, start a community, join with an invite, and (phones) your account. */
export function Sheets({ sheet, onClose }: { sheet: Exclude<ShellSheet, null>; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const pathname = usePathname();
  const { me, communities } = useShell();
  const t = `${uid}-title`;

  if (sheet === "create") {
    return (
      <ModalSheet onCancel={onClose} labelledBy={t}>
        <div className="cr-sheet-body">
          <Head id={t} title="Start a community" lead="You'll start with #announcements, #general and a voice lounge. You can change them later." onClose={onClose} />
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
            <CreateCommunityForm />
          </div>
        </div>
      </ModalSheet>
    );
  }

  if (sheet === "join") {
    return (
      <ModalSheet onCancel={onClose} labelledBy={t}>
        <div className="cr-sheet-body">
          <Head id={t} title="Join with an invite" lead="Paste the link someone sent you." onClose={onClose} />
          <div className="px-5 pb-5 pt-4">
            <JoinCommunityForm />
          </div>
        </div>
      </ModalSheet>
    );
  }

  if (sheet === "account") {
    const item = "flex items-center rounded-lg px-3 py-3 text-[15px] hover:bg-raised";
    return (
      <ModalSheet onCancel={onClose} labelledBy={t}>
        <div className="cr-sheet-body">
          <div className="flex items-center gap-3 px-5 pt-5">
            <Avatar profile={me} size={44} />
            <div className="min-w-0 flex-1 leading-tight">
              <h2 id={t} className="truncate font-semibold">
                {me.display_name}
              </h2>
              <p className="truncate text-sm text-muted">@{me.username}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-fg" aria-label="Close">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label="Account" className="cr-sheet-actions px-3 pt-3">
            <Link href={`/u/${me.username}`} className={item} onClick={onClose}>
              Your profile
            </Link>
            <Link href="/app/feed/activity" className={item} onClick={onClose}>
              Activity
            </Link>
            <Link href="/app?tab=everyone" className={item} onClick={onClose}>
              Explore
            </Link>
            <Link href="/app/settings" className={item} onClick={onClose}>
              Settings
            </Link>
            <form action="/auth/signout" method="post" className="mt-1 border-t border-line pt-1">
              <button className={`${item} w-full text-left`}>Sign out</button>
            </form>
          </nav>
        </div>
      </ModalSheet>
    );
  }

  // A new post.
  const audiences = communities.filter((c) => c.is_public).map((c) => ({ communityId: c.id, label: c.name }));
  const posted = (p: PostCard) => {
    onClose();
    window.dispatchEvent(new CustomEvent(POSTED_EVENT, { detail: p }));
    if (pathname !== "/app") router.push(`/app/feed/post/${p.id}`);
  };
  return (
    <ModalSheet onCancel={onClose} labelledBy={t} className="sm:w-[min(36rem,calc(100vw-2rem))]">
      <div className="cr-sheet-body">
        <Head id={t} title={me.public_profile ? "New post" : "Turn on your public profile"} onClose={onClose} />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2 pt-1">
          {me.public_profile ? (
            <Composer audiences={audiences} onPosted={posted} autoFocus bare />
          ) : (
            <PublicProfileSetup
              me={me}
              onDone={() => {
                onClose();
                router.refresh();
              }}
            />
          )}
        </div>
      </div>
    </ModalSheet>
  );
}
