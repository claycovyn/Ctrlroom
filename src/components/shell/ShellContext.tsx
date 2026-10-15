"use client";

import { createContext, useContext } from "react";
import type { CommunityActivity, ShellCommunity, ShellMe } from "@/lib/shell";

export type ShellSheet = "post" | "create" | "join" | "account" | null;

export interface ShellCtx {
  me: ShellMe;
  communities: ShellCommunity[];
  /** Per community id; empty until loaded (after first paint). */
  activity: Record<string, CommunityActivity>;
  activityLoaded: boolean;
  /** Unread direct messages and requests; new follows, likes and replies. */
  badges: { dms: number; activity: number };
  /** Hosted with OpenCtrl Cloud (shows Pricing in the footer links). */
  cloud: boolean;
  open: (sheet: Exclude<ShellSheet, null>) => void;
}

export const Ctx = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell outside AppShell");
  return v;
}

/** Null outside the shell (e.g. the screenshot harness for rooms). */
export function useOptionalShell(): ShellCtx | null {
  return useContext(Ctx);
}
