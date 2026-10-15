"use client";

import { useId, useState } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { charsLeft, POST_MAX, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";

export interface Audience {
  /** null: your followers. */
  communityId: string | null;
  label: string;
}

/** Write a post (or a reply): to your followers, or into a public community you're in. */
export function Composer({ me, audiences = [], replyTo = null, onPosted, placeholder = "Share something" }: { me: { id: string }; audiences?: Audience[]; replyTo?: string | null; onPosted: (p: PostCard) => void; placeholder?: string }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [to, setTo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = charsLeft(body);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !body.trim() || left < 0) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { data, error: err } = await sb.from("posts").insert({ author_id: me.id, body: body.trim(), community_id: replyTo ? null : to || null, reply_to: replyTo }).select("id").single();
    if (err || !data) {
      setBusy(false);
      return setError(cloudErrorText(err?.message) ?? "Couldn't post that. Try again.");
    }
    const { data: card } = await sb.from("post_cards").select("*").eq("id", data.id).single();
    setBusy(false);
    setBody("");
    if (card) onPosted(card as PostCard);
  };

  return (
    <form onSubmit={submit} className="border-b border-line px-4 py-3">
      <label htmlFor={`${id}-body`} className="sr-only">
        {replyTo ? "Your reply" : "New post"}
      </label>
      <textarea
        id={`${id}-body`}
        className="input min-h-[4.5rem] resize-y"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        aria-describedby={`${id}-left`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!replyTo && audiences.length > 0 && (
          <>
            <label htmlFor={`${id}-to`} className="text-sm text-muted">
              Post to
            </label>
            <select id={`${id}-to`} className="input h-9 w-auto py-0 text-sm" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Your followers</option>
              {audiences.map((a) => (
                <option key={a.communityId ?? ""} value={a.communityId ?? ""}>
                  {a.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span id={`${id}-left`} className={`ml-auto text-xs tabular-nums ${left < 0 ? "text-alert" : "text-muted"}`} aria-live="polite">
          {left < 20 ? `${left} left` : ""}
          <span className="sr-only">{`${POST_MAX} characters at most`}</span>
        </span>
        <button type="submit" className="btn-primary h-9" disabled={busy || !body.trim() || left < 0}>
          {busy ? "Posting…" : replyTo ? "Reply" : "Post"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {error}
        </p>
      )}
    </form>
  );
}
