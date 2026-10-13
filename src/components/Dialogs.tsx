"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createDialogStore, type ConfirmOptions, type DialogRequest, type DialogStore, type PromptOptions } from "@/lib/dialogs";

/**
 * Ctrl Room's own confirm and prompt dialogs. Mounted once in the root layout; components ask with
 *   const confirmDialog = useConfirm();  if (!(await confirmDialog({ title, body, confirmLabel, tone: "danger" }))) return;
 *   const promptDialog = usePrompt();    const value = await promptDialog({ title, label, defaultValue, maxLength });
 * Never use the browser's confirm() / prompt() / alert(). Custom forms (e.g. AddRoomDialog) use <ModalSheet>.
 */

const StoreCtx = createContext<DialogStore | null>(null);

function useStore(): DialogStore {
  const store = useContext(StoreCtx);
  if (!store) throw new Error("useConfirm/usePrompt outside DialogProvider");
  return store;
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const store = useStore();
  return useCallback((options) => store.confirm(options), [store]);
}

export function usePrompt(): (options: PromptOptions) => Promise<string | null> {
  const store = useStore();
  return useCallback((options) => store.prompt(options), [store]);
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDialogStore);
  const current = useSyncExternalStore(store.subscribe, store.current, () => null);
  useEffect(() => () => store.cancelAll(), [store]);
  return (
    <StoreCtx.Provider value={store}>
      {children}
      {current && <StoreDialog key={current.id} request={current} store={store} />}
    </StoreCtx.Provider>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The shared modal: a native <dialog> opened with showModal() (the page behind goes inert), a centred card from
 * 640px up and a bottom sheet below. Esc and a click on the backdrop call onCancel; Tab wraps inside; focus goes to
 * `initialFocus` (or the first field) on open and back to where it was on close. The parent unmounts it to close.
 */
export function ModalSheet({
  onCancel,
  labelledBy,
  describedBy,
  alert = false,
  initialFocus,
  children,
  className = "",
}: {
  onCancel: () => void;
  labelledBy: string;
  describedBy?: string;
  /** role="alertdialog", for destructive confirms. */
  alert?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    const first = initialFocus?.current ?? d.querySelector<HTMLElement>("[data-autofocus]") ?? d.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (d.open) d.close();
      if (!opener || !opener.isConnected) return;
      opener.focus();
      // A button inside a closed <details> menu can't take focus; give it to the menu's toggle instead.
      if (document.activeElement !== opener) opener.closest("details")?.querySelector<HTMLElement>("summary")?.focus();
    };
    // Runs once per open; initialFocus is read on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      role={alert ? "alertdialog" : undefined}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Esc: keep React in charge of closing.
      onCancel={(e) => {
        e.preventDefault();
        cancel.current();
      }}
      // The content fills the box, so a click whose target is the <dialog> itself landed on the backdrop.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel.current();
      }}
      onKeyDown={onKeyDown}
      className={`cr-sheet text-fg ${className}`}
    >
      {children}
    </dialog>
  );
}

function StoreDialog({ request, store }: { request: DialogRequest; store: DialogStore }) {
  const uid = useId();
  const { options } = request;
  const danger = options.tone === "danger";
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(request.kind === "prompt" ? (request.options.defaultValue ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  const cancel = () => store.cancel(request.id);

  useEffect(() => {
    // Prompts start with the text selected so typing replaces it.
    if (request.kind === "prompt" && !danger) inputRef.current?.select();
  }, [request.kind, danger]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (request.kind === "confirm") return store.accept(request.id);
    const err = store.submit(request.id, value);
    if (err) {
      setError(err);
      inputRef.current?.focus();
    }
  };

  const prompt = request.kind === "prompt" ? request.options : null;
  const describedBy = [options.body ? bodyId : null].filter(Boolean).join(" ") || undefined;
  const fieldDescribedBy = [prompt?.hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <ModalSheet
      onCancel={cancel}
      labelledBy={titleId}
      describedBy={describedBy}
      alert={danger}
      initialFocus={danger ? cancelRef : prompt ? inputRef : cancelRef}
    >
      <form onSubmit={onSubmit} noValidate className="cr-sheet-body">
        <div className="space-y-2 px-5 pb-4 pt-5">
          <h2 id={titleId} className="text-base font-semibold leading-snug [overflow-wrap:anywhere]">
            {options.title}
          </h2>
          {options.body && (
            <p id={bodyId} className="text-sm text-muted [overflow-wrap:anywhere]">
              {options.body}
            </p>
          )}
          {prompt && (
            <div className="pt-2">
              <label className="label" htmlFor={`${uid}-input`}>
                {prompt.label}
              </label>
              <input
                ref={inputRef}
                id={`${uid}-input`}
                className={`input ${error ? "border-alert focus:border-alert" : ""}`}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={prompt.placeholder}
                maxLength={prompt.maxLength}
                aria-invalid={error ? true : undefined}
                aria-describedby={fieldDescribedBy}
                autoComplete="off"
                enterKeyHint="done"
              />
              {prompt.hint && !error && (
                <p id={hintId} className="mt-1 text-xs text-muted">
                  {prompt.hint}
                </p>
              )}
              {error && (
                <p id={errorId} role="alert" className="mt-1 text-xs text-alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
        <SheetActions>
          <button ref={cancelRef} type="button" className="btn-outline" onClick={cancel}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button type="submit" className={danger ? "btn-danger" : "btn-primary"}>
            {options.confirmLabel ?? (prompt ? "Save" : "OK")}
          </button>
        </SheetActions>
      </form>
    </ModalSheet>
  );
}

/** The button row: side by side from 640px, stacked full-width on phones with the main action on top. */
export function SheetActions({ children }: { children: React.ReactNode }) {
  return <div className="cr-sheet-actions flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{children}</div>;
}
