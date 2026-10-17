"use client";

// The one Spine inside a community, so tapping in and out of a community keeps the exact same rail (operator,
// 2026-10-17). Same component as the social shell; its data comes from the community context.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spine } from "@/components/shell/Spine";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCommunity } from "./CommunityContext";
import { useOptionalDm } from "@/components/dm/DmContext";

export function CommunitySpine() {
  const { me, community, communities } = useCommunity();
  const dm = useOptionalDm();
  const router = useRouter();
  const [activity, setActivity] = useState(0);
  useEffect(() => {
    let live = true;
    void supabaseBrowser()
      .rpc("my_activity_unseen")
      .then(({ data }) => live && setActivity(Number(data ?? 0)));
    return () => {
      live = false;
    };
  }, []);
  return <Spine me={me} communities={communities} dms={dm?.badge ?? 0} activity={activity} activeCommunity={community.slug} onAccount={() => router.push(`/u/${me.username}`)} className="h-full" />;
}
