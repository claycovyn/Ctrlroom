"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { ImageIcon } from "@/components/chat/icons";
import { useOptionalShell } from "@/components/shell/ShellContext";
import { uploadWithProgress } from "@/lib/attachments";
import { cloudErrorText } from "@/lib/cloudErrors";
import { firstLink, isVideo, MAX_POST_MEDIA, POST_MEDIA_ACCEPT, POST_MEDIA_BUCKET, preparePostMedia, takeMedia } from "@/lib/postMedia";
import { charsLeft, POST_MAX, type PostCard } from "@/lib/social";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LinkPreviewCard } from "./LinkPreviewCard";

export interface Audience {
  /** null: your followers. */
  communityId: string | null;
  label: string;
}

/** A photo or video being added: shown at once, uploaded in the background, posted with the text. */
interface Draft {
  key: string;
  preview: string;
  mime: string;
  progress: number;
  id: string | null;
  path: string | null;
  error: string | null;
  abort: (() => void) | null;
}

/**
 * Write a post (or a reply): text, up to 4 photos or videos, and a preview of the first link. To your followers, or
 * into a public community you're in (or always into `communityId`, on a community's page).
 */
export function Composer({
  audiences = [],
  communityId = null,
  replyTo = null,
  onPosted,
  placeholder = "Share something with your people",
  autoFocus = false,
  bare = false,
}: {
  audiences?: Audience[];
  communityId?: string | null;
  replyTo?: string | null;
  onPosted: (p: PostCard) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** In a sheet: no rule underneath. */
  bare?: boolean;
}) {
  const id = useId();
  const me = useOptionalShell()?.me;
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [to, setTo] = useState<string>("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const left = charsLeft(body);
  const uploading = drafts.some((d) => !d.error && d.progress < 1);
  const failed = drafts.some((d) => d.error);

  // The link preview follows the text, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setLink(firstLink(body)), 600);
    return () => clearTimeout(t);
  }, [body]);

  const update = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const add = async (files: File[]) => {
    setError(null);
    const { take, dropped } = takeMedia(files, drafts.length);
    if (dropped) setError(`A post can have up to ${MAX_POST_MEDIA} photos or videos.`);
    const sb = supabaseBrowser();
    for (const file of take) {
      const key = `${Date.now()}-${Math.random()}`;
      const draft: Draft = { key, preview: URL.createObjectURL(file), mime: file.type, progress: 0, id: null, path: null, error: null, abort: null };
      setDrafts((list) => [...list, draft]);
      try {
        const prepared = await preparePostMedia(file);
        const { data, error: err } = await sb.rpc("create_post_media", { p_mime: prepared.mime, p_size: prepared.blob.size, p_width: prepared.width, p_height: prepared.height });
        const row = (data as { id: string; path: string }[] | null)?.[0];
        if (err || !row) throw new Error(cloudErrorText(err?.message) ?? "Couldn't add that file. Try again.");
        update(key, { id: row.id, path: row.path, mime: prepared.mime });
        const { data: auth } = await sb.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) throw new Error("Sign in again to upload files.");
        const upload = uploadWithProgress({
          bucket: POST_MEDIA_BUCKET,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          accessToken: token,
          path: row.path,
          blob: prepared.blob,
          mime: prepared.mime,
          onProgress: (progress) => update(key, { progress: Math.min(progress, 0.99) }),
        });
        update(key, { abort: upload.abort });
        await upload.done;
        update(key, { progress: 1, abort: null });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        update(key, { error: e instanceof Error ? e.message : "Upload failed. Try again." });
      }
    }
  };

  const remove = async (d: Draft) => {
    d.abort?.();
    URL.revokeObjectURL(d.preview);
    setDrafts((list) => list.filter((x) => x.key !== d.key));
    if (d.id) {
      const sb = supabaseBrowser();
      await sb.rpc("remove_post_media", { p_media: d.id });
      if (d.path) await sb.storage.from(POST_MEDIA_BUCKET).remove([d.path]);
    }
  };

  const ready = (body.trim() || drafts.length > 0) && left >= 0 && !uploading && !failed;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const target = replyTo ? null : communityId ?? (to || null);
    const { data: postId, error: err } = await sb.rpc("publish_post", { p_body: body.trim(), p_community: target, p_reply_to: replyTo, p_media: drafts.map((d) => d.id) });
    if (err || !postId) {
      setBusy(false);
      return setError(cloudErrorText(err?.message) ?? "Couldn't post that. Try again.");
    }
    const { data: card } = await sb.from("post_cards").select("*").eq("id", postId as string).single();
    setBusy(false);
    setBody("");
    drafts.forEach((d) => URL.revokeObjectURL(d.preview));
    setDrafts([]);
    if (card) onPosted(card as PostCard);
  };

  return (
    <form onSubmit={submit} className={`flex gap-3 px-4 py-3 ${bare ? "" : "border-b border-line"}`}>
      {me && (
        <span className="hidden pt-1.5 min-[400px]:block">
          <Avatar profile={me} size={40} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <label htmlFor={`${id}-body`} className="sr-only">
          {replyTo ? "Your reply" : "New post"}
        </label>
        <textarea
          id={`${id}-body`}
          autoFocus={autoFocus}
          rows={replyTo ? 2 : 3}
          className="block min-h-[3.25rem] w-full resize-none bg-transparent py-2 text-[17px] leading-snug text-fg placeholder:text-muted focus:outline-none"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
            if (files.length) {
              e.preventDefault();
              void add(files);
            }
          }}
          placeholder={placeholder}
          aria-describedby={`${id}-left`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
        />
        {drafts.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Photos and videos">
            {drafts.map((d) => (
              <li key={d.key} className="relative h-24 w-24 overflow-hidden rounded-lg border border-line bg-raised">
                {isVideo(d.mime) ? (
                  <video src={d.preview} muted playsInline className="h-full w-full object-cover" aria-label="Video" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.preview} alt="" className="h-full w-full object-cover" />
                )}
                {d.error ? (
                  <span role="alert" className="absolute inset-x-0 bottom-0 bg-bg/90 px-1 py-0.5 text-[11px] leading-tight text-alert">
                    {d.error}
                  </span>
                ) : (
                  d.progress < 1 && (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-line" aria-label={`Uploading, ${Math.round(d.progress * 100)}%`} role="progressbar" aria-valuenow={Math.round(d.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <span className="block h-full bg-signal" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                    </span>
                  )
                )}
                <button type="button" onClick={() => remove(d)} className="absolute right-1 top-1 rounded bg-bg/90 px-1.5 text-xs" aria-label="Remove">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {!drafts.length && link && <LinkPreviewCard url={link} />}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <input
            ref={fileRef}
            type="file"
            accept={POST_MEDIA_ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn-ghost -ml-2 h-9 w-9 px-0"
            onClick={() => fileRef.current?.click()}
            disabled={drafts.length >= MAX_POST_MEDIA}
            aria-label="Add a photo or video"
            title="Photo or video"
          >
            <ImageIcon className="h-5 w-5" />
          </button>
          {!replyTo && !communityId && audiences.length > 0 && (
            <>
              <label htmlFor={`${id}-to`} className="sr-only">
                Post to
              </label>
              <select
                id={`${id}-to`}
                className="h-8 max-w-[12rem] truncate rounded-full border border-line bg-bg pl-3 pr-7 text-sm font-medium text-fg focus:border-signal focus:outline-none"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
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
          <button
            type="submit"
            className={`h-9 rounded-full px-5 text-sm font-semibold transition-colors ${ready && !busy ? "bg-signal text-signal-fg hover:opacity-90" : "cursor-not-allowed border border-line bg-transparent text-muted"}`}
            disabled={busy || !ready}
          >
            {busy ? "Posting…" : uploading ? "Uploading…" : replyTo ? "Reply" : "Post"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
