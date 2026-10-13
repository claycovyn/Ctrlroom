"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useConfirm } from "@/components/Dialogs";
import { Avatar } from "@/components/chat/Avatar";
import { WHO_CAN_DM, type WhoCanDm } from "@/lib/dms";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useOptionalDm } from "./DmContext";

interface Blocked {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/** Settings → Privacy: who can message you, and the people you blocked. Saved to your account (0011). */
export function DmPrivacySettings() {
  const uid = useId();
  const supabase = supabaseBrowser();
  const dm = useOptionalDm();
  const confirmDialog = useConfirm();
  const [who, setWho] = useState<WhoCanDm>("shared_community");
  const [blocks, setBlocks] = useState<Blocked[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("my_blocks");
    setBlocks((data ?? []) as Blocked[]);
  }, []);

  useEffect(() => {
    supabaseBrowser()
      .from("dm_settings")
      .select("who_can_dm")
      .maybeSingle()
      .then(({ data }) => {
        const v = (data as { who_can_dm?: WhoCanDm } | null)?.who_can_dm;
        if (v) setWho(v);
      });
    loadBlocks();
  }, [loadBlocks]);

  const save = async (value: WhoCanDm) => {
    const prev = who;
    setWho(value);
    const { error } = await supabase.rpc("set_who_can_dm", { p_value: value });
    if (error) {
      setWho(prev);
      setStatus("Couldn't save that. Try again.");
    } else setStatus("Saved.");
    setTimeout(() => setStatus(null), 3000);
  };

  const unblock = async (b: Blocked) => {
    const ok = await confirmDialog({
      title: `Unblock ${b.display_name}?`,
      body: "They can message you again, if your setting above allows it. They aren't told.",
      confirmLabel: "Unblock",
    });
    if (!ok) return;
    const { error } = await supabase.rpc("unblock_user", { p_user: b.id });
    if (error) return setStatus("Couldn't unblock. Try again.");
    await loadBlocks();
    await dm?.refreshBlocks();
    await dm?.refresh();
  };

  return (
    <section id="privacy" className="card p-5">
      <h2 className="font-medium">Privacy</h2>
      <p className="mb-4 text-sm text-muted">For direct messages, everywhere on Ctrl Room. First messages from people you haven&apos;t talked with go to Requests.</p>
      <fieldset aria-describedby={`${uid}-status`}>
        <legend className="mb-2 text-sm font-medium">Who can message you</legend>
        <div className="space-y-2">
          {WHO_CAN_DM.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${
                who === o.value ? "border-signal bg-raised" : "border-line hover:bg-raised"
              }`}
            >
              <input type="radio" name={`${uid}-who`} value={o.value} checked={who === o.value} onChange={() => save(o.value)} className="mt-0.5 accent-current" />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p id={`${uid}-status`} role="status" className="mt-2 min-h-4 text-xs text-muted">
        {status}
      </p>

      <h3 className="mb-2 mt-4 text-sm font-medium">Blocked people</h3>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted">Nobody. Block someone from a conversation&apos;s menu or a message.</p>
      ) : (
        <ul className="divide-y divide-line">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2">
              <Avatar profile={b} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.display_name}</span>
                <span className="block truncate text-xs text-muted">@{b.username}</span>
              </span>
              <button className="btn-outline px-2.5 py-1 text-xs" onClick={() => unblock(b)}>
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
