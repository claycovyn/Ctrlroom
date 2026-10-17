import { SpineShell } from "@/components/shell/SpineShell";
import { isConfigured } from "@/lib/env";
import { loadShell } from "@/lib/shellData";

/**
 * Everything signed in shares this layout: the Feed and profiles ((shell)), DMs (app/dm) and the communities (c), so
 * the Spine stays mounted and only the content beside it changes. Signed out or not set up, it adds nothing.
 */
export default async function SpineLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return children;
  const data = await loadShell();
  if (!data) return children;
  return (
    <SpineShell me={data.me} communities={data.communities}>
      {children}
    </SpineShell>
  );
}
