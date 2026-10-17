export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NotConfigured } from "@/components/NotConfigured";
import { StandaloneDm } from "@/components/dm/DmPages";
import { isConfigured } from "@/lib/env";
import { dmEntry } from "../load";

export const metadata: Metadata = { title: "Direct messages" };

export default async function AppDmConversation({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await dmEntry(id);
  return <StandaloneDm me={me} id={id} />;
}
