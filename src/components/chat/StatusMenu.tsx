"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DisplayStatus, ManualStatus } from "@/lib/presence";
import type { Profile } from "@/lib/types";
import { disablePush, isPushActive } from "@/lib/pushClient";
import { Avatar } from "./Avatar";
import { CheckIcon } from "./icons";
import { usePresence } from "./PresenceContext";
import { StatusDot } from "./PresenceAvatar";

const CHOICES: { value: ManualStatus; label: string; hint: string; dot: DisplayStatus }[] = [
  { value: "auto", label: "Online", hint: "Shows Away after 5 minutes without activity.", dot: "online" },
  { value: "dnd", label: "Do not disturb", hint: "No sounds. People see you're busy.", dot: "dnd" },
  { value: "invisible", label: "Appear offline", hint: "Nobody sees you here. You still see everyone.", dot: "offline" },
];

/**
 * Your avatar: shows your status and opens a menu. `account` makes it the full account menu (settings, Help, Sign
 * out) for the places where there's no separate footer (phones); `placement` opens it up (default, for a footer) or
 * down (for a header).
 */
export function StatusMenu({ me, settingsHref, account = false, placement = "up" }: { me: Profile; settingsHref: string; account?: boolean; placement?: "up" | "down" }) {
  const presence = usePresence();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!presence) return <Avatar profile={me} size={32} />;
  const { status, label, peer } = presence.statusOf(me.id);
  const shown = presence.manual === "invisible" ? "Appear offline" : label;

  const pick = (m: ManualStatus) => {
    presence.setManual(m);
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={button}
        className="relative flex rounded-lg"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Your status: ${shown}. Change status`}
        title={`${shown} · change status`}
      >
        <Avatar profile={me} size={32} />
        {presence.manual === "invisible" ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 box-content h-2.5 w-2.5 rounded-full border-2 border-panel bg-panel shadow-[inset_0_0_0_2px_rgb(var(--muted))]"
          />
        ) : (
          <StatusDot status={status} label="" video={peer?.call?.video} size={32} />
        )}
      </button>
      {open && (
        <div role="menu" aria-label="Set your status" className={`absolute left-0 z-20 w-64 rounded-lg border border-line bg-panel py-1 text-sm shadow-lg ${placement === "down" ? "top-full mt-2" : "bottom-full mb-2"}`}>
          {peer?.call && <p className="border-b border-line px-3 pb-2 pt-1.5 text-xs text-muted">{label}</p>}
          {CHOICES.map((c) => {
            const checked = presence.manual === c.value;
            return (
              <button
                key={c.value}
                role="menuitemradio"
                aria-checked={checked}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-raised focus:bg-raised focus:outline-none"
                onClick={() => pick(c.value)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
                  const i = items.indexOf(e.currentTarget);
                  items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
                }}
              >
                <span className="relative mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
                  {c.dot === "offline" ? (
                    <span className="absolute inset-[3px] rounded-full shadow-[inset_0_0_0_2px_rgb(var(--muted))]" />
                  ) : (
                    <span className="absolute inset-[3px] flex items-center justify-center rounded-full">
                      <MenuDot status={c.dot} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.label}</span>
                  <span className="block text-xs text-muted">{c.hint}</span>
                </span>
                {checked && <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />}
              </button>
            );
          })}
          <div className="mt-1 border-t border-line pt-1">
            <Link href={settingsHref} role="menuitem" className="block px-3 py-2 text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)}>
              {account ? "Settings" : "Profile photo and sounds"}
            </Link>
            {account && (
              <>
                <Link href="/docs" role="menuitem" className="block px-3 py-2 text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)}>
                  Help
                </Link>
                <form
                  action="/auth/signout"
                  method="post"
                  onSubmit={(e) => {
                    // A signed-out phone shouldn't keep getting this account's notifications.
                    if (!isPushActive()) return;
                    e.preventDefault();
                    const form = e.currentTarget;
                    Promise.race([disablePush(), new Promise((r) => setTimeout(r, 1500))]).finally(() => form.submit());
                  }}
                >
                  <button role="menuitem" className="block w-full px-3 py-2 text-left text-muted hover:bg-raised hover:text-fg">
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuDot({ status }: { status: DisplayStatus }) {
  if (status === "dnd")
    return (
      <span className="flex h-full w-full items-center justify-center rounded-full bg-alert">
        <span className="block h-[2px] w-[60%] rounded-full bg-panel" />
      </span>
    );
  return <span className="block h-full w-full rounded-full bg-signal" />;
}
