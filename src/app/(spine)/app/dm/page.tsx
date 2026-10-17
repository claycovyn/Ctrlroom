export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { NotConfigured } from "@/components/NotConfigured";
import { StandaloneDm } from "@/components/dm/DmPages";
import { isConfigured } from "@/lib/env";
import { dmEntry } from "./load";

export const metadata: Metadata = { title: "Direct messages" };

export default async function AppDm() {
  if (!isConfigured()) return <NotConfigured />;
  const me = await dmEntry(null);
  return <StandaloneDm me={me} id={null} />;
}
