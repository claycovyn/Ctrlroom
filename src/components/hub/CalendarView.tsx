"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCommunity } from "@/components/chat/CommunityContext";
import { PlusIcon, VoiceIcon } from "@/components/chat/icons";
import { RichText } from "@/components/chat/RichText";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type CalendarEvent, type RsvpStatus } from "@/lib/types";
import { Page } from "./PageHeader";

interface Rsvp {
  event_id: string;
  user_id: string;
  status: RsvpStatus;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function CalendarView({ initialEvents, initialRsvps }: { initialEvents: CalendarEvent[]; initialRsvps: Rsvp[] }) {
  const { me, role, community, rooms, onCommunityEvent } = useCommunity();
  const supabase = supabaseBrowser();
  const isMod = atLeast(role, "mod");
  const [events, setEvents] = useState(initialEvents);
  const [rsvps, setRsvps] = useState(initialRsvps);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      onCommunityEvent((event, p: { op: string; event: CalendarEvent }) => {
        if (event !== "event") return;
        setEvents((list) => {
          const rest = list.filter((e) => e.id !== p.event.id);
          return p.op === "delete" ? rest : [...rest, p.event].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
        });
      }),
    [onCommunityEvent],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      const k = dayKey(new Date(e.starts_at));
      m.set(k, [...(m.get(k) ?? []), e]);
    });
    return m;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const upcoming = events
    .filter((e) => new Date(e.ends_at).getTime() >= now)
    .filter((e) => !selected || dayKey(new Date(e.starts_at)) === selected);

  const rsvp = async (eventId: string, status: RsvpStatus) => {
    const mine = rsvps.find((r) => r.event_id === eventId && r.user_id === me.id);
    const prev = rsvps;
    if (mine?.status === status) {
      setRsvps((list) => list.filter((r) => !(r.event_id === eventId && r.user_id === me.id)));
      const { error: err } = await supabase.from("event_rsvps").delete().match({ event_id: eventId, user_id: me.id });
      if (err) setRsvps(prev);
      return;
    }
    setRsvps((list) => [...list.filter((r) => !(r.event_id === eventId && r.user_id === me.id)), { event_id: eventId, user_id: me.id, status }]);
    const { error: err } = await supabase.from("event_rsvps").upsert({ event_id: eventId, user_id: me.id, status });
    if (err) setRsvps(prev);
  };

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Page
      wide
      title="Calendar"
      actions={
        isMod && (
          <button className="btn-primary py-1.5 text-xs" onClick={() => setCreating((v) => !v)}>
            <PlusIcon className="h-4 w-4" /> New event
          </button>
        )
      }
    >
      {creating && (
        <NewEvent
          onCancel={() => setCreating(false)}
          onCreated={(e) => {
            setEvents((list) => [...list.filter((x) => x.id !== e.id), e].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)));
            setCreating(false);
          }}
          onError={setError}
        />
      )}
      {error && <p className="mb-3 text-sm text-alert">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="card p-4" aria-label="Month">
          <div className="mb-3 flex items-center justify-between">
            <button className="btn-ghost px-2 py-1" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
              ←
            </button>
            <h2 className="font-semibold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
            <button className="btn-ghost px-2 py-1" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="bg-panel py-1.5 text-center font-medium text-muted">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              const inMonth = d.getMonth() === month.getMonth();
              const today = k === dayKey(new Date());
              return (
                <button
                  key={k}
                  onClick={() => setSelected(selected === k ? null : k)}
                  className={`min-h-[64px] bg-panel p-1 text-left align-top sm:min-h-[84px] ${inMonth ? "" : "opacity-40"} ${selected === k ? "ring-2 ring-inset ring-signal" : "hover:bg-raised"}`}
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${today ? "bg-signal font-bold text-signal-fg" : ""}`}>{d.getDate()}</span>
                  {list.slice(0, 2).map((e) => (
                    <span key={e.id} className="mt-0.5 block truncate rounded bg-raised px-1 text-[11px]">
                      {new Date(e.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} {e.title}
                    </span>
                  ))}
                  {list.length > 2 && <span className="block px-1 text-[11px] text-muted">+{list.length - 2} more</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">Times shown in your time zone ({tz}).</p>
        </section>

        <section aria-label="Upcoming events">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{selected ? "That day" : "Upcoming"}</h2>
            {selected && (
              <button className="text-xs text-muted underline" onClick={() => setSelected(null)}>
                Show all
              </button>
            )}
          </div>
          {upcoming.length === 0 ? (
            <div className="card p-6 text-center text-sm text-muted">{isMod ? "Nothing scheduled. Create an event to get people together." : "Nothing scheduled yet."}</div>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((e) => {
                const start = new Date(e.starts_at);
                const end = new Date(e.ends_at);
                const room = rooms.find((r) => r.id === e.room_id);
                const live = now >= start.getTime() - 15 * 60_000 && now <= end.getTime();
                const mine = rsvps.find((r) => r.event_id === e.id && r.user_id === me.id)?.status;
                const going = rsvps.filter((r) => r.event_id === e.id && r.status === "going").length;
                return (
                  <li key={e.id} className="card p-4">
                    <div className="flex gap-3">
                      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-raised leading-none">
                        <span className="text-[10px] font-semibold uppercase text-muted">{start.toLocaleDateString(undefined, { month: "short" })}</span>
                        <span className="text-lg font-bold">{start.getDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold leading-snug">{e.title}</h3>
                        <p className="text-xs text-muted">
                          {start.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                          {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} –{" "}
                          {end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                        </p>
                        {live && <span className="mt-1 inline-block rounded-full bg-signal px-2 py-0.5 text-[11px] font-semibold text-signal-fg">Happening now</span>}
                      </div>
                    </div>
                    {e.description && (
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted">
                        <RichText body={e.description} myUsername={me.username} />
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {room && (
                        <Link href={`/c/${community.slug}/${room.slug}`} className={`${live ? "btn-primary" : "btn-outline"} py-1.5 text-xs`}>
                          <VoiceIcon className="h-3.5 w-3.5" /> {live ? "Join" : "In"} #{room.name}
                        </Link>
                      )}
                      {e.location_url && (
                        <a href={e.location_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-outline py-1.5 text-xs">
                          Link ↗
                        </a>
                      )}
                      <a href={`/api/events/${e.id}/ics`} className="btn-ghost py-1.5 text-xs">
                        Add to calendar
                      </a>
                    </div>
                    <div className="mt-3 flex items-center gap-1 border-t border-line pt-3 text-xs" role="group" aria-label="Are you going?">
                      {(["going", "maybe", "no"] as RsvpStatus[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => rsvp(e.id, s)}
                          aria-pressed={mine === s}
                          className={`rounded-full px-3 py-1 ${mine === s ? "bg-signal text-signal-fg" : "bg-raised text-muted hover:text-fg"}`}
                        >
                          {s === "going" ? "Going" : s === "maybe" ? "Maybe" : "Can’t make it"}
                        </button>
                      ))}
                      <span className="ml-auto text-muted">{going} going</span>
                    </div>
                    {isMod && (
                      <button
                        className="mt-2 text-xs text-muted hover:text-alert"
                        onClick={async () => {
                          if (!confirm(`Delete “${e.title}”?`)) return;
                          const { error: err } = await supabase.from("events").delete().eq("id", e.id);
                          if (!err) setEvents((list) => list.filter((x) => x.id !== e.id));
                        }}
                      >
                        Delete event
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}

function NewEvent({ onCancel, onCreated, onError }: { onCancel: () => void; onCreated: (e: CalendarEvent) => void; onError: (m: string | null) => void }) {
  const { me, community, rooms } = useCommunity();
  const voice = rooms.filter((r) => r.kind === "voice");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const [roomId, setRoomId] = useState(voice[0]?.id ?? "");
  const [link, setLink] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card mb-6 grid gap-3 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        const start = new Date(`${date}T${time}`);
        if (Number.isNaN(start.getTime())) return onError("Pick a date and time.");
        setBusy(true);
        const { data, error } = await supabaseBrowser()
          .from("events")
          .insert({
            community_id: community.id,
            title: title.trim(),
            description: description.trim(),
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
            room_id: roomId || null,
            location_url: link.trim() || null,
            created_by: me.id,
          })
          .select()
          .single();
        setBusy(false);
        if (error) return onError("Couldn’t create the event.");
        onCreated(data as CalendarEvent);
      }}
    >
      <h2 className="font-medium sm:col-span-2">New event</h2>
      <input className="input sm:col-span-2" placeholder="Office hours, workshop, game night…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required aria-label="Event title" />
      <label className="text-sm">
        <span className="label">Date</span>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="label">Starts</span>
          <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="text-sm">
          <span className="label">Length</span>
          <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-sm">
        <span className="label">Where</span>
        <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === "voice" ? "🔊" : "#"} {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">Link (optional)</span>
        <input type="url" className="input" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      <textarea className="input min-h-[80px] sm:col-span-2" placeholder="What’s it about? (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} aria-label="Description" />
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create event"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
