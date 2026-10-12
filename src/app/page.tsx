import Link from "next/link";
import { Logo, LogoMark } from "@/components/Logo";

const FIXES = [
  {
    title: "Your history stays",
    body: "Every message and every search, forever, for every community. No 90-day cutoff and no paywall on search.",
  },
  {
    title: "Quiet by default",
    body: "You only get pinged when someone @mentions you or replies to you. Each room can be turned up or muted.",
  },
  {
    title: "While you were gone",
    body: "Come back to a short recap: how many new messages, who talked, which threads got busy and what got decided.",
  },
  {
    title: "Threads that finish",
    body: "Open a thread alongside the room. When it's settled, close it with an outcome. The outcome shows in the room and gets pinned.",
  },
  {
    title: "A board in every room",
    body: "Decisions, links and docs sit on the room's board, so they don't get buried under chat.",
  },
  {
    title: "Voice, video, screen share",
    body: "Drop into a voice room, or start a call from any room. Camera and screen share work right in the browser.",
  },
  {
    title: "Simple roles",
    body: "Owner, admin, mod, member. Mods clean up spam and remove or ban people. That's the whole permission system.",
  },
  {
    title: "No upsells, no ID checks",
    body: "No paid tier and no ID scans. Ctrl Room keeps only what it needs to run your community.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo className="h-7 w-auto sm:h-8" />
        <nav className="flex items-center gap-2">
          <Link href="/docs" className="btn-ghost hidden sm:inline-flex">
            Docs
          </Link>
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/login?mode=signup" className="btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <LogoMark className="mb-8 h-20 w-20 sm:h-24 sm:w-24" />
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-muted">An OpenCtrl original</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Where the collective talks.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          Ctrl Room is a home for your community, with rooms, threads, voice and video. We started from what people
          dislike about Discord and Slack and fixed it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login?mode=signup" className="btn-primary px-5 py-2.5 text-base">
            Start a community
          </Link>
          <Link href="/login" className="btn-outline px-5 py-2.5 text-base">
            I have an invite
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FIXES.map((f) => (
            <div key={f.title} className="bg-panel p-5">
              <h2 className="font-medium">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 text-sm text-muted sm:px-6">
          <span>Ctrl Room by OpenCtrl</span>
          <span>Built by the collective.</span>
        </div>
      </footer>
    </main>
  );
}
