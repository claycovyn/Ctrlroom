/**
 * The desktop app's installers, for /download. They're published as releases on a public repo (the app's code repo
 * can stay private); set CTRLROOM_DESKTOP_REPO to point a fork at its own. Pure rules here; the fetch is in the page.
 */

export const DESKTOP_REPO = process.env.CTRLROOM_DESKTOP_REPO || "claycovyn/ctrlroom-downloads";

export type DesktopOs = "windows" | "mac" | "linux";

export type Installer = { os: DesktopOs; label: string; name: string; url: string; size: number; primary: boolean };

export type DesktopRelease = { version: string; page: string; installers: Installer[] };

type GithubAsset = { name: string; browser_download_url: string; size: number };
type GithubRelease = { tag_name: string; html_url: string; draft?: boolean; assets: GithubAsset[] };

// Order matters: the first match for an OS is its main button.
const KINDS: { ext: string; os: DesktopOs; label: string }[] = [
  { ext: "-setup.exe", os: "windows", label: "Installer (.exe)" },
  { ext: ".msi", os: "windows", label: "Windows Installer (.msi)" },
  { ext: ".dmg", os: "mac", label: "Disk image (.dmg), Apple silicon and Intel" },
  { ext: ".appimage", os: "linux", label: "AppImage (any distribution)" },
  { ext: ".deb", os: "linux", label: "Debian / Ubuntu (.deb)" },
  { ext: ".rpm", os: "linux", label: "Fedora / openSUSE (.rpm)" },
];

/** The installers in a GitHub release, main one per OS first. Anything else (signatures, archives) is left out. */
export function parseRelease(release: GithubRelease | null | undefined): DesktopRelease | null {
  if (!release || release.draft || !Array.isArray(release.assets)) return null;
  const installers: Installer[] = [];
  for (const kind of KINDS) {
    for (const a of release.assets) {
      if (!a.name.toLowerCase().endsWith(kind.ext)) continue;
      if (!a.browser_download_url.startsWith("https://github.com/")) continue;
      const primary = !installers.some((i) => i.os === kind.os);
      installers.push({ os: kind.os, label: kind.label, name: a.name, url: a.browser_download_url, size: a.size, primary });
    }
  }
  if (!installers.length) return null;
  return { version: release.tag_name.replace(/^desktop-/, "").replace(/^v/, ""), page: release.html_url, installers };
}

/** Which computer the visitor is on, from the user agent. Phones and tablets get null (there's no desktop app). */
export function detectOs(userAgent: string | null | undefined): DesktopOs | null {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
}

export const OS_NAME: Record<DesktopOs, string> = { windows: "Windows", mac: "macOS", linux: "Linux" };

export function formatSize(bytes: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
