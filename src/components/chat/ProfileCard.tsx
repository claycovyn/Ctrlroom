"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";
import { useOptionalCommunity } from "./CommunityContext";
import { PresenceAvatar } from "./PresenceAvatar";
import { usePeerStatus } from "./PresenceContext";

const ROLE_TAG: Partial<Record<Role, string>> = { owner: "Owner", admin: "Admin", mod: "Mod" };

interface CardData {
  profile: Profile;
  role: Role | null;
  joined_at: string | null;
}

// One lookup per person per community for the page's life; a miss (not a member, renamed) is remembered too.
const cache = new Map<string, Promise<CardData | null>>();

function loadCard(communityId: string | null, username: string): Promise<CardData | null> {
  const key = `${communityId ?? ""}|${username}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const supabase = supabaseBrowser();
      if (communityId) {
        const { data } = await supabase
          .from("community_members")
          .select("role, joined_at, profiles!inner(id, username, display_name, avatar_url, is_bot)")
          .eq("community_id", communityId)
          .eq("profiles.username", username)
          .maybeSingle();
        const row = data as unknown as { role: Role; joined_at: string; profiles: Profile } | null;
        if (row?.profiles) return { profile: row.profiles, role: row.role, joined_at: row.joined_at };
      }
      // The AI helpers aren't members; outside a community (DMs) there's no role to show.
      const { data } = await supabase.from("profiles").select("id, username, display_name, avatar_url, is_bot").eq("username", username).maybeSingle();
      return data ? { profile: data as Profile, role: null, joined_at: null } : null;
    })().catch(() => {
      cache.delete(key);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
const CARD_W = 260;

/**
 * Hover (or focus, or tap) a name to see who it is: photo, name, @username, role and status. The card is in a portal so
 * a scrolling list or a panel doesn't clip it.
 */
export function ProfileHover({ username, className, children }: { username: string; className?: string; children: React.ReactNode }) {
  const community = useOptionalCommunity()?.community ?? null;
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<CardData | null | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
    // Below the name, or above it when it's near the bottom of the window (the composer is there).
    const above = r.bottom + 180 > window.innerHeight;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
    loadCard(community?.id ?? null, username).then(setCard);
  }, [community?.id, username, place]);

  const openSoon = () => {
    clear();
    timer.current = setTimeout(show, OPEN_DELAY);
  };
  const closeSoon = () => {
    clear();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    // A tap anywhere else closes it (phones have no pointer leaving).
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !document.getElementById(id)?.contains(t)) close();
    };
    document.addEventListener("pointerdown", away);
    // Any scroll moves the name away from the card.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", away);
    };
  }, [open, id]);

  useEffect(() => clear, []);

  return (
    <>
      <span
        ref={anchor}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`cursor-pointer ${className ?? ""}`}
        onPointerEnter={(e) => e.pointerType === "mouse" && openSoon()}
        onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
        // Keyboard focus only: a click focuses too, and the click itself opens it.
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={closeSoon}
        onClick={(e) => {
          e.stopPropagation();
          clear();
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (open) setOpen(false);
            else show();
          }
        }}
      >
        {children}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            id={id}
            role="dialog"
            aria-label={card?.profile.display_name ?? `@${username}`}
            className="fixed z-50 rounded-xl border border-line bg-panel p-4 text-sm shadow-lg"
            style={{ left: pos.left, top: pos.top, width: CARD_W, transform: pos.above ? "translateY(-100%)" : undefined }}
            onPointerEnter={clear}
            onPointerLeave={closeSoon}
          >
            {card === undefined ? (
              <p className="text-muted">Loading…</p>
            ) : card === null ? (
              <p className="text-muted">No one here goes by @{username}.</p>
            ) : (
              <CardBody card={card} />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function CardBody({ card }: { card: CardData }) {
  const { profile, role, joined_at } = card;
  const peer = usePeerStatus(profile.is_bot ? undefined : profile.id);
  const tag = role ? ROLE_TAG[role] : undefined;
  return (
    <div className="flex items-start gap-3">
      <PresenceAvatar profile={profile} size={52} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-semibold">{profile.display_name}</span>
          {profile.is_bot && <span className="shrink-0 rounded bg-signal px-1 text-[10px] font-bold uppercase leading-4 text-signal-fg">AI</span>}
        </div>
        <div className="truncate text-muted">@{profile.username}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {tag && <span className="rounded bg-raised px-1.5 py-0.5 font-medium uppercase tracking-wide">{tag}</span>}
          {peer && <span>{peer.label}</span>}
          {joined_at && Date.parse(joined_at) > 0 && <span>Joined {new Date(joined_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}
        </div>
        {!profile.is_bot && (
          <a href={`/u/${profile.username}`} className="mt-2 inline-block text-xs font-medium text-fg underline decoration-muted underline-offset-2 hover:decoration-fg">
            View profile
          </a>
        )}
      </div>
    </div>
  );
}
