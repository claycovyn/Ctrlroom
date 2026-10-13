"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { cloudErrorText } from "@/lib/cloudErrors";
import { kindOf, pickProblem, prepareFile, takeFiles, uploadWithProgress, type FileKind, type Prepared } from "@/lib/attachments";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Where the files go: a room (messages and thread replies) or a DM conversation. */
export type AttachScope = { kind: "room"; roomId: string } | { kind: "dm"; conversationId: string };

/** What post_message / post_dm take. */
export interface OutgoingAttachment {
  id: string;
  alt?: string;
}

export interface Draft {
  key: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  kind: FileKind;
  /** A local preview for images (object URL). */
  preview: string | null;
  status: "preparing" | "uploading" | "ready" | "failed";
  progress: number;
  error: string | null;
  alt: string;
  id: string | null;
  path: string | null;
  prepared: Prepared | null;
  abort: (() => void) | null;
}

let seq = 0;

/**
 * The files waiting in a composer: each one is checked and shrunk (photos), reserved (create_attachment) and
 * uploaded with progress. Remove cancels and deletes it; a failed one can be retried. Leaving the composer (another
 * room, closing a thread) removes whatever wasn't sent.
 */
export function useAttachmentDrafts(scope: AttachScope | null) {
  const list = useRef<Draft[]>([]);
  const [, render] = useReducer((n: number) => n + 1, 0);
  const notice = useRef<string | null>(null);
  const scopeKey = scope ? (scope.kind === "room" ? `room:${scope.roomId}` : `dm:${scope.conversationId}`) : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const get = (key: string) => list.current.find((d) => d.key === key);
  const update = useCallback((key: string, patch: Partial<Draft>) => {
    list.current = list.current.map((d) => (d.key === key ? { ...d, ...patch } : d));
    render();
  }, []);

  const discard = useCallback(async (d: Draft) => {
    d.abort?.();
    if (d.preview) URL.revokeObjectURL(d.preview);
    if (!d.id) return;
    const supabase = supabaseBrowser();
    const { error } = await supabase.rpc("remove_attachment", { p_id: d.id });
    if (!error && d.path) await supabase.storage.from("attachments").remove([d.path]).catch(() => undefined);
  }, []);

  const run = useCallback(
    async (key: string) => {
      const s = scopeRef.current;
      const start = get(key);
      if (!s || !start) return;
      update(key, { status: start.prepared ? "uploading" : "preparing", error: null, progress: 0 });
      try {
        const prepared = start.prepared ?? (await prepareFile(start.file));
        if (!get(key)) return;
        update(key, { prepared, name: prepared.name, size: prepared.blob.size, mime: prepared.mime, kind: kindOf(prepared.mime), status: "uploading" });
        const supabase = supabaseBrowser();
        let { id, path } = get(key)!;
        if (!id || !path) {
          const { data, error } = await supabase.rpc("create_attachment", {
            p_room: s.kind === "room" ? s.roomId : null,
            p_conversation: s.kind === "dm" ? s.conversationId : null,
            p_name: prepared.name,
            p_mime: prepared.mime,
            p_size: prepared.blob.size,
            p_width: prepared.width,
            p_height: prepared.height,
          });
          if (error || !data) throw new Error(cloudErrorText(error?.message) ?? "Couldn't add that file. Try again.");
          ({ id, path } = data as { id: string; path: string });
          if (!get(key)) {
            await discard({ ...start, id, path, preview: null, abort: null });
            return;
          }
          update(key, { id, path });
        }
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) throw new Error("Sign in again to upload files.");
        const upload = uploadWithProgress({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          accessToken: token,
          path: path!,
          blob: prepared.blob,
          mime: prepared.mime,
          onProgress: (progress) => update(key, { progress }),
        });
        update(key, { abort: upload.abort });
        await upload.done;
        if (get(key)) update(key, { status: "ready", progress: 1, abort: null });
      } catch (e) {
        if ((e as Error).name === "AbortError" || !get(key)) return;
        update(key, { status: "failed", abort: null, error: (e as Error).message || "Upload failed. Try again." });
      }
    },
    [update, discard],
  );

  const add = useCallback(
    (files: File[]) => {
      if (!scopeRef.current || !files.length) return;
      const { take, message } = takeFiles(files, list.current.length);
      const problems: string[] = [];
      const added: Draft[] = [];
      for (const file of take) {
        const problem = pickProblem(file, list.current.length + added.length);
        if (problem) {
          problems.push(`${file.name}: ${problem}`);
          continue;
        }
        const mime = file.type || "";
        const image = mime.startsWith("image/");
        added.push({
          key: `f${++seq}`,
          file,
          name: file.name || "file",
          size: file.size,
          mime,
          kind: image ? "image" : kindOf(mime),
          preview: image ? URL.createObjectURL(file) : null,
          status: "preparing",
          progress: 0,
          error: null,
          alt: "",
          id: null,
          path: null,
          prepared: null,
          abort: null,
        });
      }
      notice.current = [message, ...problems].filter(Boolean).join(" ") || null;
      list.current = [...list.current, ...added];
      render();
      added.forEach((d) => run(d.key));
    },
    [run],
  );

  const remove = useCallback(
    (key: string) => {
      const d = get(key);
      if (!d) return;
      list.current = list.current.filter((x) => x.key !== key);
      render();
      discard(d);
    },
    [discard],
  );

  const retry = useCallback((key: string) => run(key), [run]);
  const setAlt = useCallback((key: string, alt: string) => update(key, { alt }), [update]);
  const dismissNotice = useCallback(() => {
    notice.current = null;
    render();
  }, []);

  /** After the message is sent: the files belong to it now. */
  const clear = useCallback(() => {
    list.current.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
    list.current = [];
    notice.current = null;
    render();
  }, []);

  // Moving to another room or conversation (or closing the composer) removes what wasn't sent.
  useEffect(
    () => () => {
      const left = list.current;
      list.current = [];
      left.forEach((d) => discard(d));
    },
    [scopeKey, discard],
  );

  const drafts = list.current;
  return {
    enabled: Boolean(scope),
    drafts,
    notice: notice.current,
    busy: drafts.some((d) => d.status === "preparing" || d.status === "uploading"),
    failed: drafts.some((d) => d.status === "failed"),
    ready: drafts.filter((d) => d.status === "ready" && d.id).map((d): OutgoingAttachment => ({ id: d.id!, alt: d.kind === "image" ? d.alt.trim() : undefined })),
    add,
    remove,
    retry,
    setAlt,
    clear,
    dismissNotice,
  };
}

export type AttachmentDrafts = ReturnType<typeof useAttachmentDrafts>;
