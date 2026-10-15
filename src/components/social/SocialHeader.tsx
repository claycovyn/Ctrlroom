import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ActivityLink } from "./ActivityLink";

/** The top bar of the Feed, profiles and posts: back to your communities, Feed, Activity, Messages, your profile. */
export function SocialHeader({ me, current }: { me: { id: string; username: string } | null; current?: "feed" | "activity" | "me" }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        <Link href="/app" aria-label="Your communities">
          <Logo />
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Social">
          <Link href="/app/feed" className="btn-ghost" aria-current={current === "feed" ? "page" : undefined}>
            Feed
          </Link>
          {me && <ActivityLink userId={me.id} current={current === "activity"} />}
          <Link href="/app/dm" className="btn-ghost max-sm:hidden">
            Messages
          </Link>
          {me && (
            <Link href={`/u/${me.username}`} className="btn-ghost" aria-current={current === "me" ? "page" : undefined}>
              Profile
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
