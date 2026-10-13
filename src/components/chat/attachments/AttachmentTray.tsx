"use client";

import { useRef } from "react";
import { usePrompt } from "@/components/Dialogs";
import { ACCEPT, MAX_ALT, formatBytes, type FileKind } from "@/lib/attachments";
import {
  ArchiveIcon,
  AudioIcon,
  CloseIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  PaperclipIcon,
  RetryIcon,
  SheetIcon,
  SlidesIcon,
} from "../icons";
import type { AttachmentDrafts, Draft } from "./useAttachmentDrafts";

export function FileKindIcon({ kind, className = "h-5 w-5" }: { kind: FileKind; className?: string }) {
  const Icon = { image: ImageIcon, pdf: FileTextIcon, text: FileTextIcon, doc: FileTextIcon, sheet: SheetIcon, slides: SlidesIcon, archive: ArchiveIcon, audio: AudioIcon, video: FilmIcon }[kind] ?? FileIcon;
  return <Icon className={className} />;
}

/** The paperclip button in the composer: opens the file picker. */
export function AttachButton({ files, disabled }: { files: AttachmentDrafts; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="rounded-md p-1.5 text-muted hover:text-fg disabled:opacity-40"
        onClick={() => input.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="Attach files (or paste, or drop them here)"
      >
        <PaperclipIcon />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          files.add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Files waiting to send, above the message box: progress, cancel, retry, remove and image descriptions. */
export function AttachmentTray({ files }: { files: AttachmentDrafts }) {
  const promptDialog = usePrompt();
  if (!files.drafts.length && !files.notice) return null;

  const describe = async (d: Draft) => {
    const alt = await promptDialog({
      title: "Describe this image",
      label: "Description",
      defaultValue: d.alt,
      maxLength: MAX_ALT,
      required: false,
      hint: "Read aloud by screen readers. Leave it empty and it's just “Image”.",
      confirmLabel: "Save",
    });
    if (alt !== null) files.setAlt(d.key, alt.trim());
  };

  return (
    <div className="border-b border-line pb-2">
      {files.notice && (
        <p role="alert" className="flex items-start gap-2 px-1 pb-2 text-xs text-alert">
          <span className="min-w-0 flex-1">{files.notice}</span>
          <button type="button" className="text-muted hover:text-fg" onClick={files.dismissNotice} aria-label="Dismiss">
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
      {files.drafts.length > 0 && (
        <ul className="scroll-thin -mt-1.5 flex gap-2 overflow-x-auto pb-1 pr-2 pt-2" aria-label="Files to send">
          {files.drafts.map((d) => (
            <DraftTile key={d.key} d={d} onRemove={() => files.remove(d.key)} onRetry={() => files.retry(d.key)} onDescribe={() => describe(d)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftTile({ d, onRemove, onRetry, onDescribe }: { d: Draft; onRemove: () => void; onRetry: () => void; onDescribe: () => void }) {
  const working = d.status === "preparing" || d.status === "uploading";
  const status =
    d.status === "failed" ? d.error ?? "Upload failed." : d.status === "preparing" ? "Preparing…" : d.status === "uploading" ? `${Math.round(d.progress * 100)}%` : formatBytes(d.size);
  return (
    <li className={`relative flex w-44 shrink-0 items-center gap-2 rounded-md border bg-raised p-1.5 ${d.status === "failed" ? "border-alert/60" : "border-line"}`}>
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-panel text-muted">
        {d.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileKindIcon kind={d.kind} />
        )}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-medium" title={d.name}>
          {d.name}
        </span>
        <span className={`block truncate text-[11px] ${d.status === "failed" ? "text-alert" : "text-muted"}`} title={status}>
          {status}
        </span>
        {d.kind === "image" && !working && d.status !== "failed" && (
          <button type="button" className="block truncate text-[11px] text-signal hover:underline" onClick={onDescribe}>
            {d.alt ? "Edit description" : "Add description"}
          </button>
        )}
        {d.status === "failed" && (
          <button type="button" className="inline-flex items-center gap-1 text-[11px] text-signal hover:underline" onClick={onRetry}>
            <RetryIcon className="h-3 w-3" /> Retry
          </button>
        )}
      </span>
      <button
        type="button"
        className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-panel p-0.5 text-muted shadow-sm hover:text-fg"
        onClick={onRemove}
        aria-label={working ? `Cancel ${d.name}` : `Remove ${d.name}`}
        title={working ? "Cancel" : "Remove"}
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      {working && (
        <span className="absolute inset-x-1.5 bottom-0.5 h-0.5 overflow-hidden rounded bg-line" aria-hidden="true">
          <span className="block h-full bg-signal transition-[width]" style={{ width: `${Math.max(4, Math.round(d.progress * 100))}%` }} />
        </span>
      )}
    </li>
  );
}
