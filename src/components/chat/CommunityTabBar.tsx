"use client";

// The shared bottom bar inside a community (phones): shown while you browse the channel list, hidden once you're in a
// room (its composer owns the bottom), so moving between a community and the feed/DMs keeps the same navigation.
import { useRouter } from "next/navigation";
import { MobileTabBar, useTabBadges } from "@/components/shell/MobileTabBar";
import type { Profile } from "@/lib/types";
import { useNavOpen } from "./CommunityContext";

export function CommunityTabBar({ me }: { me: Profile }) {
  const router = useRouter();
  const navOpen = useNavOpen();
  const { dms, activity } = useTabBadges(me);
  return <MobileTabBar me={me} dms={dms} activity={activity} onCompose={() => router.push("/app?compose=post")} show={navOpen} />;
}
