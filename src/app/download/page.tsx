import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Logo } from "@/components/Logo";
import {
  DESKTOP_REPO,
  detectOs,
  formatSize,
  OS_NAME,
  parseRelease,
  type DesktopOs,
  type DesktopRelease,
  type Installer,
} from "@/lib/desktopDownloads";

export const metadata: Metadata = {
  title: "Download",
  description: "Ctrl Room for Windows, macOS and Linux.",
};

async function latestRelease(): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    return parseRelease(await res.json());
  } catch {
    return null;
  }
}

const ORDER: DesktopOs[] = ["windows", "mac", "linux"];

// First-open steps for unsigned builds. Remove when the installers are signed.
const FIRST_OPEN: Record<DesktopOs, string> = {
  windows: "Windows may say “Windows protected your PC” the first time. Click More info, then Run anyway.",
  mac: "Drag Ctrl Room to Applications. The first time, macOS may block it: open System Settings → Privacy & Security and click Open Anyway.",
  linux: "For the AppImage, make it executable (chmod +x) and run it.",
};

export default async function Download() {
  const [release, ua] = await Promise.all([latestRelease(), headers().then((h) => h.get("user-agent"))]);
  const mine = detectOs(ua);
  const main = release?.installers.find((i) => i.primary && i.os === mine);

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/">
          <Logo className="h-7 w-auto sm:h-8" />
        </Link>
        <Link href="/login" className="btn-ghost">
          Sign in
        </Link>
      </header>
      <section className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ctrl Room for your computer.</h1>
        <p className="mt-4 text-lg text-muted">
          Its own window, icon and alerts, so calls and chat don&rsquo;t get lost in your browser tabs. Same account, same
          communities as the web.
        </p>

        {!release ? (
          <div className="card mt-10 p-6">
            <p className="font-medium">The desktop app isn&rsquo;t available to download yet.</p>
            <p className="mt-1 text-sm text-muted">Ctrl Room works in any browser in the meantime.</p>
            <Link href="/login" className="btn-primary mt-4 inline-flex">
              Open Ctrl Room in your browser
            </Link>
          </div>
        ) : (
          <>
            {main && mine ? (
              <div className="card mt-10 p-6">
                <a href={main.url} className="btn-primary inline-flex">
                  Download for {OS_NAME[mine]}
                </a>
                <p className="mt-3 text-sm text-muted">
                  Version {release.version} · {main.label}
                  {main.size ? ` · ${formatSize(main.size)}` : ""}
                </p>
                <p className="mt-3 text-sm text-muted">{FIRST_OPEN[mine]}</p>
              </div>
            ) : (
              mine === null && (
                <p className="card mt-10 p-6 text-sm text-muted">
                  On a phone? Open Ctrl Room in your browser and add it to your Home Screen. The downloads below are for
                  computers.
                </p>
              )
            )}

            <h2 className="mt-12 text-lg font-semibold">All downloads</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {ORDER.map((os) => {
                const list = release.installers.filter((i) => i.os === os);
                if (!list.length) return null;
                return (
                  <section key={os} className="card p-5">
                    <h3 className="font-medium">{OS_NAME[os]}</h3>
                    <ul className="mt-3 space-y-2 text-sm">
                      {list.map((i) => (
                        <InstallerLink key={i.name} installer={i} />
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted">{FIRST_OPEN[os]}</p>
                  </section>
                );
              })}
            </div>
            <p className="mt-8 text-sm text-muted">
              Version {release.version}.{" "}
              <a href={release.page} className="underline decoration-line underline-offset-4 hover:decoration-fg">
                Release notes and older versions
              </a>
              . The installers aren&rsquo;t code-signed yet, which is why your computer asks before the first open.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function InstallerLink({ installer }: { installer: Installer }) {
  return (
    <li>
      <a href={installer.url} className="underline decoration-line underline-offset-4 hover:decoration-fg">
        {installer.label}
      </a>
      {installer.size ? <span className="text-muted"> · {formatSize(installer.size)}</span> : null}
    </li>
  );
}
