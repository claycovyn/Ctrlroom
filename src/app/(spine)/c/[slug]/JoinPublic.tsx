"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { noteJoinedCommunity } from "@/lib/pushClient";
import { supabaseBrowser } from "@/lib/supabase/client";

export function JoinPublic({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn-primary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error: err } = await supabaseBrowser().rpc("join_public", { p_slug: slug });
          if (err) {
            setError(err.message.includes("cannot join") ? "You can't join this community." : "Couldn't join. Try again.");
            setBusy(false);
            return;
          }
          noteJoinedCommunity();
          router.refresh();
        }}
      >
        {busy ? "Joining…" : "Join community"}
      </button>
      {error && <p className="mt-2 text-sm text-alert">{error}</p>}
    </>
  );
}
