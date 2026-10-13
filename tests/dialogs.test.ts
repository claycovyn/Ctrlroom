import { describe, expect, it, vi } from "vitest";
import { checkPrompt, createDialogStore } from "@/lib/dialogs";

describe("confirm", () => {
  it("resolves true on accept and false on cancel", async () => {
    const store = createDialogStore();
    const yes = store.confirm({ title: "Delete #general?" });
    store.accept(store.current()!.id);
    await expect(yes).resolves.toBe(true);
    expect(store.current()).toBeNull();

    const no = store.confirm({ title: "Leave OpenCtrl?" });
    store.cancel(store.current()!.id);
    await expect(no).resolves.toBe(false);
  });

  it("ignores a stale id, so a double click can't settle the next dialog", async () => {
    const store = createDialogStore();
    const first = store.confirm({ title: "one" });
    const second = store.confirm({ title: "two" });
    const id = store.current()!.id;
    store.accept(id);
    store.accept(id);
    expect(store.current()?.options.title).toBe("two");
    await expect(first).resolves.toBe(true);
    store.cancel(store.current()!.id);
    await expect(second).resolves.toBe(false);
  });
});

describe("prompt", () => {
  it("resolves the trimmed value, or null on cancel", async () => {
    const store = createDialogStore();
    const named = store.prompt({ title: "Rename", label: "Section name" });
    expect(store.submit(store.current()!.id, "  Events  ")).toBeNull();
    await expect(named).resolves.toBe("Events");

    const cancelled = store.prompt({ title: "Rename", label: "Section name" });
    store.cancel(store.current()!.id);
    await expect(cancelled).resolves.toBeNull();
  });

  it("stays open with the error when the value doesn't pass", async () => {
    const store = createDialogStore();
    const p = store.prompt({ title: "Rename", label: "Section name", maxLength: 48 });
    const id = store.current()!.id;
    expect(store.submit(id, "   ")).toBe("This can't be empty.");
    expect(store.submit(id, "x".repeat(49))).toBe("Keep it to 48 characters or fewer.");
    expect(store.current()?.id).toBe(id);
    expect(store.submit(id, "x".repeat(48))).toBeNull();
    await expect(p).resolves.toBe("x".repeat(48));
  });

  it("allows empty when not required (ban reason)", async () => {
    const store = createDialogStore();
    const p = store.prompt({ title: "Ban Sam?", label: "Reason", required: false, tone: "danger" });
    expect(store.submit(store.current()!.id, "")).toBeNull();
    await expect(p).resolves.toBe("");
  });

  it("accept() does nothing to a prompt", () => {
    const store = createDialogStore();
    void store.prompt({ title: "Rename", label: "Name" });
    store.accept(store.current()!.id);
    expect(store.current()?.kind).toBe("prompt");
  });
});

describe("checkPrompt", () => {
  it("runs min, max and the custom check on the trimmed value", () => {
    expect(checkPrompt(" ab ", { minLength: 3 })).toBe("Use at least 3 characters.");
    expect(checkPrompt(" abc ", { minLength: 3, maxLength: 3 })).toBeNull();
    const validate = vi.fn((v: string) => (v === "general" ? "Taken." : null));
    expect(checkPrompt(" general ", { validate })).toBe("Taken.");
    expect(validate).toHaveBeenCalledWith("general");
    expect(checkPrompt("dev", { validate })).toBeNull();
  });
});

describe("queue", () => {
  it("shows one at a time in order and tells listeners", async () => {
    const store = createDialogStore();
    const seen: (string | null)[] = [];
    const off = store.subscribe(() => seen.push(store.current()?.options.title ?? null));
    const a = store.confirm({ title: "A" });
    const b = store.prompt({ title: "B", label: "Name" });
    const c = store.confirm({ title: "C" });
    expect(store.current()?.options.title).toBe("A");
    expect(store.waiting()).toBe(2);

    store.accept(store.current()!.id);
    expect(store.current()?.options.title).toBe("B");
    store.submit(store.current()!.id, "dev");
    expect(store.current()?.options.title).toBe("C");
    store.cancel(store.current()!.id);
    expect(store.current()).toBeNull();

    await expect(Promise.all([a, b, c])).resolves.toEqual([true, "dev", false]);
    expect(seen).toEqual(["A", "A", "A", "B", "C", null]);
    off();
    void store.confirm({ title: "D" });
    expect(seen).toHaveLength(6);
  });

  it("cancelAll resolves everything as cancelled", async () => {
    const store = createDialogStore();
    const a = store.confirm({ title: "A" });
    const b = store.prompt({ title: "B", label: "Name" });
    store.cancelAll();
    await expect(Promise.all([a, b])).resolves.toEqual([false, null]);
    expect(store.current()).toBeNull();
  });
});
