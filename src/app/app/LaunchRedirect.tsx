"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { lastPlace } from "@/components/chat/roomNav";

/**
 * Opening the Home Screen app on a phone (start_url /app?launch=1) goes straight back to the room you were in. Only
 * on launch: the communities list itself stays reachable from the rail.
 */
export function LaunchRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("launch") !== "1") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const place = lastPlace();
    if (place) router.replace(place);
  }, [router]);
  return null;
}
