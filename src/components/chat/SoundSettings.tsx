"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SOUND_PREFS, play, readSoundPrefs, writeSoundPrefs, type SoundKind, type SoundName, type SoundPrefs } from "@/lib/sounds";

const ROWS: { kind: SoundKind; label: string; hint: string; sample: SoundName }[] = [
  { kind: "messages", label: "Messages", hint: "New messages in rooms set to Everything, when you're not looking at that room.", sample: "message" },
  { kind: "mentions", label: "Mentions & replies", hint: "Someone @mentions you or replies to you.", sample: "mention" },
  { kind: "calls", label: "Calls", hint: "People join or leave your call, and a call starts in the room you're in.", sample: "call-join" },
  { kind: "mic", label: "Mic", hint: "You mute or unmute in a call.", sample: "unmute" },
  { kind: "sent", label: "Sent", hint: "A tick when your message goes out.", sample: "sent" },
];

/** Settings → Sounds. Saved on this device only. */
export function SoundSettings() {
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_SOUND_PREFS);
  useEffect(() => setPrefs(readSoundPrefs()), []);

  const update = (next: SoundPrefs) => {
    setPrefs(next);
    writeSoundPrefs(next);
  };
  const preview = (name: SoundName) => play(name, { preview: true });

  return (
    <section id="sounds" className="card p-5">
      <h2 className="font-medium">Sounds</h2>
      <p className="mb-4 text-sm text-muted">Saved on this device. Do not disturb and muted rooms stay silent.</p>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Play sounds</span>
        <input
          type="checkbox"
          role="switch"
          className="h-4 w-4 accent-[rgb(var(--signal))]"
          checked={prefs.enabled}
          onChange={(e) => update({ ...prefs, enabled: e.target.checked })}
        />
      </label>

      <div className={`mt-4 space-y-4 ${prefs.enabled ? "" : "opacity-50"}`}>
        <label className="block">
          <span className="label">Volume · {Math.round(prefs.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            className="w-full accent-[rgb(var(--signal))]"
            value={Math.round(prefs.volume * 100)}
            disabled={!prefs.enabled}
            aria-valuetext={`${Math.round(prefs.volume * 100)}%`}
            onChange={(e) => update({ ...prefs, volume: Number(e.target.value) / 100 })}
          />
        </label>

        <ul className="divide-y divide-line rounded-md border border-line">
          {ROWS.map((r) => (
            <li key={r.kind} className="flex items-center gap-3 px-3 py-2.5">
              <input
                id={`sound-${r.kind}`}
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[rgb(var(--signal))]"
                checked={prefs.kinds[r.kind]}
                disabled={!prefs.enabled}
                onChange={(e) => update({ ...prefs, kinds: { ...prefs.kinds, [r.kind]: e.target.checked } })}
              />
              <label htmlFor={`sound-${r.kind}`} className="min-w-0 flex-1">
                <span className="block text-sm">{r.label}</span>
                <span className="block text-xs text-muted">{r.hint}</span>
              </label>
              <button
                type="button"
                className="btn-outline shrink-0 px-2.5 py-1 text-xs"
                onClick={() => preview(r.sample)}
                aria-label={`Play the ${r.label.toLowerCase()} sound`}
              >
                Play
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
