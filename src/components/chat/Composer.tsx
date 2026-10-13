"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SendIcon } from "./icons";

interface Suggestion {
  username: string;
  display_name: string;
  hint?: string;
}

const BOTS: Suggestion[] = [
  { username: "ctrl", display_name: "Ctrl", hint: "AI: questions and web research" },
  { username: "openctrl", display_name: "OpenCtrl", hint: "AI: help with OpenCtrl apps" },
];

export function Composer({
  placeholder,
  communityId,
  disabled,
  disabledReason,
  onSend,
  onTyping,
  autoFocus,
}: {
  placeholder: string;
  /** For @mention suggestions; null turns them off (direct messages). */
  communityId: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onSend: (body: string) => Promise<boolean>;
  onTyping?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  // Grow with content, up to a limit.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [body]);

  const mentionQuery = (() => {
    const el = ref.current;
    const upto = body.slice(0, el?.selectionStart ?? body.length);
    const m = upto.match(/(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{1,32})$/);
    return m ? m[1].toLowerCase() : null;
  })();

  useEffect(() => {
    if (!mentionQuery || !communityId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser()
        .from("community_members")
        .select("user_id, profiles!inner(username, display_name)")
        .eq("community_id", communityId)
        .ilike("profiles.username", `${mentionQuery}%`)
        .limit(6);
      if (cancelled) return;
      const bots = BOTS.filter((b) => b.username.startsWith(mentionQuery));
      setSuggestions([...bots, ...((data ?? []) as unknown as { profiles: Suggestion }[]).map((r) => r.profiles)].slice(0, 7));
      setActive(0);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mentionQuery, communityId]);

  const pick = (s: Suggestion) => {
    const el = ref.current;
    const cursor = el?.selectionStart ?? body.length;
    const before = body.slice(0, cursor).replace(/@([a-zA-Z0-9_]{1,32})$/, `@${s.username} `);
    const next = before + body.slice(cursor);
    setBody(next);
    setSuggestions([]);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setBody("");
    ref.current?.focus();
  };

  if (disabled) {
    return (
      <div className="px-4 pb-4">
        <div className="rounded-lg border border-line bg-raised px-4 py-3 text-sm text-muted">{disabledReason}</div>
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-4">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-lg border border-line bg-panel shadow-lg" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.username}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-raised" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                <span className="font-medium">{s.display_name}</span>
                <span className="text-muted">@{s.username}</span>
                {s.hint && <span className="ml-auto truncate text-xs text-muted">{s.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-line bg-panel px-3 py-2 focus-within:border-signal">
        <textarea
          ref={ref}
          rows={1}
          value={body}
          autoFocus={autoFocus}
          maxLength={4000}
          placeholder={placeholder}
          className="scroll-thin max-h-60 flex-1 resize-none bg-transparent py-1 text-[15px] placeholder:text-muted focus:outline-none"
          onChange={(e) => {
            setBody(e.target.value);
            const now = Date.now();
            if (onTyping && now - lastTyping.current > 3000) {
              lastTyping.current = now;
              onTyping();
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(suggestions[active]);
                return;
              }
              if (e.key === "Escape") {
                setSuggestions([]);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="rounded-md p-1.5 text-muted hover:text-signal disabled:opacity-40"
          onClick={submit}
          disabled={!body.trim() || sending}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
