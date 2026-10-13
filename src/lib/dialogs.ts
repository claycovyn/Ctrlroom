// In-app confirm and prompt dialogs: the store behind <DialogProvider> (src/components/Dialogs.tsx). No React here,
// so the queue and the validation are tested on their own (tests/dialogs.test.ts). One dialog shows at a time; a
// request made while one is open waits its turn. Never use the browser's confirm() / prompt() / alert().

export type DialogTone = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger": the confirm button uses the alert color, the dialog is role="alertdialog" and Cancel gets focus. */
  tone?: DialogTone;
}

export interface PromptOptions extends ConfirmOptions {
  label: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  /** Empty (after trimming) is an error unless this is false. Default true. */
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Runs on the trimmed value after the built-in checks; return a message to block, nothing to accept. */
  validate?: (value: string) => string | null | undefined;
}

export type DialogRequest =
  | { id: number; kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

/** The error to show for a prompt value, or null when it can be submitted. Checks the trimmed value. */
export function checkPrompt(raw: string, options: Pick<PromptOptions, "required" | "minLength" | "maxLength" | "validate">): string | null {
  const value = raw.trim();
  if (!value) return options.required === false ? (options.validate?.(value) ?? null) : "This can't be empty.";
  if (options.minLength && value.length < options.minLength) return `Use at least ${options.minLength} characters.`;
  if (options.maxLength && value.length > options.maxLength) return `Keep it to ${options.maxLength} characters or fewer.`;
  return options.validate?.(value) ?? null;
}

export interface DialogStore {
  /** The dialog on screen, or null. */
  current(): DialogRequest | null;
  /** How many are waiting behind the current one. */
  waiting(): number;
  subscribe(listener: () => void): () => void;
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  /** Confirm the current confirm dialog. */
  accept(id: number): void;
  /** Submit the current prompt. Returns the error to show (the dialog stays open), or null when it resolved. */
  submit(id: number, raw: string): string | null;
  /** Cancel (Esc, backdrop, Cancel button): confirm resolves false, prompt null. */
  cancel(id: number): void;
  /** Cancel everything, e.g. when the provider unmounts. */
  cancelAll(): void;
}

export function createDialogStore(): DialogStore {
  let queue: DialogRequest[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const settle = (id: number, value: boolean | string | null) => {
    const head = queue[0];
    if (!head || head.id !== id) return;
    queue = queue.slice(1);
    if (head.kind === "confirm") head.resolve(value === true);
    else head.resolve(typeof value === "string" ? value : null);
    emit();
  };

  return {
    current: () => queue[0] ?? null,
    waiting: () => Math.max(0, queue.length - 1),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    confirm(options) {
      return new Promise<boolean>((resolve) => {
        queue = [...queue, { id: nextId++, kind: "confirm", options, resolve }];
        emit();
      });
    },
    prompt(options) {
      return new Promise<string | null>((resolve) => {
        queue = [...queue, { id: nextId++, kind: "prompt", options, resolve }];
        emit();
      });
    },
    accept(id) {
      if (queue[0]?.kind === "confirm") settle(id, true);
    },
    submit(id, raw) {
      const head = queue[0];
      if (!head || head.id !== id || head.kind !== "prompt") return null;
      const error = checkPrompt(raw, head.options);
      if (error) return error;
      settle(id, raw.trim());
      return null;
    },
    cancel(id) {
      const head = queue[0];
      if (head?.id === id) settle(id, head.kind === "confirm" ? false : null);
    },
    cancelAll() {
      const all = queue;
      queue = [];
      for (const r of all) {
        if (r.kind === "confirm") r.resolve(false);
        else r.resolve(null);
      }
      if (all.length) emit();
    },
  };
}
