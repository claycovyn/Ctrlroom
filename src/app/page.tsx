import Link from "next/link";
import type { Metadata } from "next";
import { CheckIcon } from "@/components/chat/icons";
import { Logo } from "@/components/Logo";
import { BoardArt, CallArt, HelperArt, IconsArt, ImagesArt, OutcomeArt, RequestArt, ROOM_ICON_COUNT } from "@/components/landing/FeatureArt";
import { HeroMark } from "@/components/landing/HeroMark";
import { ProductMock } from "@/components/landing/ProductMock";
import { Reveal } from "@/components/landing/Reveal";
import { CtaLink, Cut, Eyebrow, H2, LEAD } from "@/components/landing/parts";
import s from "@/components/landing/landing.module.css";
import { amountLine, CLOUD, CLOUD_PRICE_LABEL, cloudEnabled } from "@/lib/cloud";

export const metadata: Metadata = {
  title: { absolute: "Ctrl Room · Where the collective talks." },
  description:
    "Community chat with rooms, threads, voice and video. Full history and search, quiet by default, threads that close with an outcome. Open source, by OpenCtrl.",
};

// Every line here is something Ctrl Room does today (README.md, content/docs/ctrl-room).
const FIXES = [
  {
    pain: "History that runs out",
    fix: "Every message stays, in every community, on every plan.",
  },
  {
    pain: "Search you pay for",
    fix: "Search every message from all time. It's free. Quotes for exact phrases, a minus to leave a word out.",
  },
  {
    pain: "Pings for everything",
    fix: "Quiet by default. Only @mentions and replies to you ping. Set each room to Everything, Mentions or Muted.",
  },
  {
    pain: "A wall of unread",
    fix: "While you were gone: a recap of new messages, who talked, busy threads, decisions and your pings.",
  },
  {
    pain: "Threads that never end",
    fix: "Threads open side by side and close with an outcome. The outcome shows in the room and can go on the board.",
  },
  {
    pain: "Upsells and ID checks",
    fix: "No feature paywalls and no ID checks. Four plain roles: owner, admin, mod, member.",
  },
];

const FEATURES = [
  {
    title: "Rooms, sections and pins",
    body: `Group rooms under sections, give each one of ${ROOM_ICON_COUNT} built-in icons, and pin the rooms you use most. Pins are just for you.`,
    art: <IconsArt />,
    span: "lg:col-span-3",
  },
  {
    title: "Threads with outcomes",
    body: "Reply in a thread next to the room. When it's settled, close it with what was decided. Closed threads can be reopened.",
    art: <OutcomeArt />,
    span: "lg:col-span-3",
  },
  {
    title: "A board in every room",
    body: "Decisions, links, docs and notes, kept out of the scroll. Pin any message, or add items straight to the board.",
    art: <BoardArt />,
    span: "lg:col-span-2",
  },
  {
    title: "Voice, video, screen share",
    body: "Voice rooms open a call bar when you walk in. Any text room can start a call. It all runs in the browser.",
    art: <CallArt />,
    span: "lg:col-span-2",
  },
  {
    title: "@ctrl, in the chat",
    body: "Mention @ctrl to ask a question or research the web. It lists its sources and answers in a thread. @openctrl answers from the docs.",
    art: <HelperArt />,
    span: "lg:col-span-2",
  },
  {
    title: "Photos, images and covers",
    body: "Add a profile photo, a community image and a cover. Crop in the browser; Ctrl Room shrinks the file before it uploads.",
    art: <ImagesArt />,
    span: "lg:col-span-3",
  },
  {
    title: "Requests to join",
    body: "Let people ask to join a private community. They see its name, image, cover and description, nothing else. Admins approve or decline.",
    art: <RequestArt />,
    span: "lg:col-span-3",
  },
];

const OPEN = [
  {
    label: "AGPL-3.0",
    title: "Open source",
    body: "Read the code, change it, run it. Contributions welcome.",
    link: { href: "/source", text: "View the source" },
  },
  {
    label: "Self-host",
    title: "Your server",
    body: "Next.js, Supabase and LiveKit. A self-hosted Ctrl Room has no paid tier and no limits.",
    link: { href: "/docs/ctrl-room/self-hosting", text: "Running your own server" },
  },
  {
    label: "Export",
    title: "Your data",
    body: "Owners and admins can export a whole community at any time. Nothing is deleted for usage.",
    link: { href: "/docs", text: "Read the docs" },
  },
  {
    label: "Open models",
    title: "Your AI",
    body: "The helpers talk to any OpenAI-compatible endpoint, including open models through Ollama or vLLM.",
    link: { href: "/docs/ctrl-room/ai-helpers", text: "How the helpers work" },
  },
];

export default function Home() {
  const cloud = cloudEnabled();
  const freeLines = Object.keys(CLOUD.meters)
    .filter((k) => (CLOUD.free[k] ?? 0) > 0)
    .map((k) => amountLine(k, CLOUD.free[k]));

  return (
    <div className={s.page}>
      <div className={s.backdrop} aria-hidden="true" />
      <div className={s.glow} aria-hidden="true" />

      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="shrink-0 rounded-sm">
            <Logo className="h-6 w-auto sm:h-7" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
            <Link href="/docs" className="btn-ghost hidden sm:inline-flex">
              Docs
            </Link>
            {cloud && (
              <Link href="/pricing" className="btn-ghost hidden sm:inline-flex">
                Pricing
              </Link>
            )}
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
            <CtaLink href="/login?mode=signup" small>
              Get started
            </CtaLink>
          </nav>
        </div>
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-6 text-center sm:px-6 sm:pt-10">
          <div className={s.rise}>
            <HeroMark />
          </div>
          <div className={s.rise} style={{ "--d": "120ms" } as React.CSSProperties}>
            <Eyebrow className="mt-2 justify-center">An OpenCtrl original</Eyebrow>
          </div>
          <h1
            className={`${s.rise} mx-auto mt-6 max-w-4xl text-balance text-[clamp(2.75rem,7.5vw,5.25rem)] font-semibold leading-[0.98] tracking-[-0.045em]`}
            style={{ "--d": "200ms" } as React.CSSProperties}
          >
            <span className={s.chrome}>Where the collective talks.</span>
          </h1>
          <p
            className={`${s.rise} ${LEAD} mx-auto mt-6 max-w-2xl sm:text-xl`}
            style={{ "--d": "300ms" } as React.CSSProperties}
          >
            Community chat with rooms, threads, voice and video, built around what people dislike about Discord and Slack.
          </p>
          <div className={`${s.rise} mt-8 flex flex-wrap justify-center gap-3`} style={{ "--d": "400ms" } as React.CSSProperties}>
            <CtaLink href="/login?mode=signup">Start a community</CtaLink>
            <CtaLink href="/login" variant="glass">
              I have an invite
            </CtaLink>
          </div>
          <p className={`${s.rise} mt-6 text-sm text-muted`} style={{ "--d": "480ms" } as React.CSSProperties}>
            Free and open source.{" "}
            <Link href="/docs" className="font-medium text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
              Read the docs
            </Link>
          </p>
        </section>

        {/* Product */}
        <section className="mx-auto mt-12 max-w-[78rem] px-4 sm:mt-16 sm:px-6" aria-labelledby="product-heading">
          <h2 id="product-heading" className="sr-only">
            What Ctrl Room looks like
          </h2>
          <Reveal className="relative">
            <div className={s.underGlow} aria-hidden="true" />
            <figure>
              <Cut cut={28} inner="overflow-hidden">
                <div
                  role="img"
                  aria-label="The Ctrl Room app: communities on the left, a sidebar of rooms grouped in sections, a room with a call bar, a closed thread with its outcome, and an open thread beside it."
                >
                  <ProductMock />
                </div>
              </Cut>
              <figcaption className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Illustration · names and messages are examples
              </figcaption>
            </figure>
          </Reveal>
        </section>

        {/* Fixes */}
        <section className="mx-auto mt-28 max-w-6xl px-4 sm:mt-40 sm:px-6" aria-labelledby="fixes-heading">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <Reveal className="lg:sticky lg:top-28 lg:self-start">
              <Eyebrow>Why Ctrl Room</Eyebrow>
              <h2 id="fixes-heading" className={`${H2} mt-5`}>
                What people dislike about Discord and Slack, <span className="text-muted">fixed.</span>
              </h2>
              <p className={`${LEAD} mt-5 max-w-md`}>We started from the complaints and worked backwards.</p>
            </Reveal>
            <ul className="border-t border-line">
              {FIXES.map((f, i) => (
                <li key={f.pain}>
                  <Reveal delay={i * 50} className="grid gap-2 border-b border-line py-6 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-8 sm:py-7">
                    <p className="flex items-baseline gap-3 text-[15px] text-muted sm:pt-0.5">
                      <span className="font-mono text-[11px] tracking-[0.1em] text-muted" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="line-through decoration-muted/50">
                        <span className="sr-only">Instead of: </span>
                        {f.pain}
                      </span>
                    </p>
                    <p className="flex gap-3 text-pretty text-[17px] leading-relaxed sm:text-lg">
                      <CheckIcon className="mt-[0.3em] h-4 w-4 shrink-0 text-signal" />
                      <span>{f.fix}</span>
                    </p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto mt-28 max-w-6xl px-4 sm:mt-40 sm:px-6" aria-labelledby="features-heading">
          <Reveal className="max-w-2xl">
            <Eyebrow>In every community</Eyebrow>
            <h2 id="features-heading" className={`${H2} mt-5`}>
              Built for talking, and for finishing the conversation.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 70} className={`${f.span} ${i === FEATURES.length - 1 && FEATURES.length % 2 ? "sm:col-span-2" : ""}`}>
                <Cut hover cut={18} className="h-full" inner="flex h-full flex-col">
                  <div className={`${s.stage} flex h-40 items-center justify-center px-6 sm:px-8`}>
                    <div className="w-full max-w-sm">{f.art}</div>
                  </div>
                  <div className="p-6 pt-5 sm:px-7 sm:pb-7">
                    <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
                    <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted">{f.body}</p>
                  </div>
                </Cut>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Free and open */}
        <section className="mx-auto mt-28 max-w-6xl px-4 sm:mt-40 sm:px-6" aria-labelledby="open-heading">
          <Reveal className="max-w-2xl">
            <Eyebrow>Free and open</Eyebrow>
            <h2 id="open-heading" className={`${H2} mt-5`}>
              The software is free. <span className="text-muted">So is leaving.</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
            {OPEN.map((o, i) => (
              <Reveal
                key={o.label}
                delay={i * 60}
                className="border-b border-line py-8 sm:pr-8 lg:border-b-0 lg:border-l lg:pl-6 lg:first:border-l-0 lg:first:pl-0"
              >
                <p className={`${s.chrome} font-mono text-2xl font-semibold tracking-tight`}>{o.label}</p>
                <h3 className="mt-5 font-semibold">{o.title}</h3>
                <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted">{o.body}</p>
                {/* /source redirects off-site, so it's a plain link (no client-side prefetch). */}
                <a href={o.link.href} className="mt-4 inline-block text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-fg">
                  {o.link.text}
                </a>
              </Reveal>
            ))}
          </div>
        </section>

        {/* OpenCtrl Cloud (hosted installs only, like the pricing link) */}
        {cloud && (
          <section className="mx-auto mt-28 max-w-6xl px-4 sm:mt-32 sm:px-6" aria-labelledby="cloud-heading">
            <Reveal>
              <Cut cut={24} quiet inner="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center">
                <div>
                  <Eyebrow>OpenCtrl Cloud</Eyebrow>
                  <h2 id="cloud-heading" className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    Rather not run a server?
                  </h2>
                  <p className="mt-3 text-pretty text-muted">
                    Use it hosted. Every feature is in every plan, and you can export everything at any time.
                  </p>
                  <Link href="/pricing" className="mt-4 inline-block text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-fg">
                    See pricing
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-bg/60 p-5">
                    <p className="text-sm font-semibold">Free Cloud</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight">$0</p>
                    <ul className="mt-3 space-y-1 text-sm text-muted">
                      {freeLines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    <CtaLink href="/login?mode=signup" small className="mt-5">
                      Start free
                    </CtaLink>
                  </div>
                  <div className="rounded-lg border border-signal/60 bg-bg/60 p-5">
                    <p className="text-sm font-semibold">OpenCtrl Cloud</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight">
                      {CLOUD_PRICE_LABEL.replace("/month", "")}
                      <span className="text-base font-normal text-muted"> a month</span>
                    </p>
                    <ul className="mt-3 space-y-1 text-sm text-muted">
                      <li>Every hosted OpenCtrl original, one subscription.</li>
                      <li>Never paused.</li>
                    </ul>
                    <span className="mt-5 inline-flex min-h-9 items-center rounded-md border border-line px-3 text-sm font-medium text-muted">
                      Coming soon
                    </span>
                  </div>
                </div>
              </Cut>
            </Reveal>
          </section>
        )}

        {/* Closing */}
        <section className="mx-auto mt-28 max-w-6xl px-4 pb-24 sm:mt-40 sm:px-6 sm:pb-32" aria-labelledby="start-heading">
          <Reveal>
            <Cut cut={32} inner="relative overflow-hidden px-6 py-16 text-center sm:px-12 sm:py-24">
              <div className={s.backdrop} style={{ height: "100%" }} aria-hidden="true" />
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/ctrlroom-icon-192.png" alt="" width={192} height={192} className="mx-auto h-16 w-16" />
                <h2 id="start-heading" className={`${H2} mx-auto mt-8 max-w-2xl`}>
                  <span className={s.chrome}>Open a room for your people.</span>
                </h2>
                <p className={`${LEAD} mx-auto mt-5 max-w-xl`}>
                  Every new community starts with #announcements, #general and a voice room. One account works for every
                  community you join.
                </p>
                <div className="mt-9 flex flex-wrap justify-center gap-3">
                  <CtaLink href="/login?mode=signup">Start a community</CtaLink>
                  <CtaLink href="/login" variant="glass">
                    I have an invite
                  </CtaLink>
                </div>
              </div>
            </Cut>
          </Reveal>
        </section>
      </main>

      <footer className="relative border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-3">
            <Logo className="h-6 w-auto" />
            <p>Built by the collective. AGPL-3.0.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            <Link href="/docs" className="hover:text-fg">
              Docs
            </Link>
            {cloud && (
              <Link href="/pricing" className="hover:text-fg">
                Pricing
              </Link>
            )}
            <a href="/source" className="hover:text-fg">
              Source
            </a>
            <Link href="/login" className="hover:text-fg">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
