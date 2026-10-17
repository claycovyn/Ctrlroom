"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCommunity } from "@/components/chat/CommunityContext";
import { lastRoom } from "@/components/chat/roomNav";

/**
 * /c/<slug> on a phone: back to the last room you had open here, or, the first time, the rooms (navigation panel)
 * so you pick one. Desktop and tablets never get here (the page redirects to a room on the server).
 */
export function CommunityLanding({ slugs, fallback }: { slugs: string[]; fallback: string | null }) {
  const router = useRouter();
  const { community, setNavOpen } = useCommunity();
  useEffect(() => {
    const last = lastRoom(community.slug);
    if (last && slugs.includes(last)) router.replace(`/c/${community.slug}/${last}`);
    else if (window.matchMedia("(max-width: 767px)").matches) setNavOpen(true);
    else if (fallback) router.replace(`/c/${community.slug}/${fallback}`);
  }, [community.slug, slugs, fallback, router, setNavOpen]);
  return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">Pick a room.</div>;
}
