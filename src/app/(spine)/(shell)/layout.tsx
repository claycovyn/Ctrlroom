import { AppShell } from "@/components/shell/AppShell";
import { cloudEnabled } from "@/lib/cloud";
import { isConfigured } from "@/lib/env";
import { loadShell } from "@/lib/shellData";

/**
 * The signed-in shell around Home (/app), the Feed's pages, Communities, Settings and profiles (/u/<name>). A layout,
 * so the rail, the right column and their live badges stay mounted while you move between them. Signed out (the
 * pages redirect to sign in) or not set up, it adds nothing.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return children;
  const data = await loadShell();
  if (!data) return children;
  return (
    <AppShell me={data.me} communities={data.communities} cloud={cloudEnabled()}>
      {children}
    </AppShell>
  );
}
