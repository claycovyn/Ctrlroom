"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCommunity } from "@/components/chat/CommunityContext";
import { LockIcon, PlusIcon } from "@/components/chat/icons";
import { levelFor } from "@/lib/levels";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Course, type CourseCard } from "@/lib/types";
import { Page } from "./PageHeader";

export function ClassroomView({ courses }: { courses: CourseCard[] }) {
  const { me, role, community, points } = useCommunity();
  const router = useRouter();
  const isAdmin = atLeast(role, "admin");
  const myLevel = points[me.id] !== undefined ? levelFor(points[me.id]) : null;
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("");
  const [unlock, setUnlock] = useState(1);
  const [error, setError] = useState<string | null>(null);

  return (
    <Page
      wide
      title="Classroom"
      actions={
        isAdmin && (
          <button className="btn-primary py-1.5 text-xs" onClick={() => setCreating((v) => !v)}>
            <PlusIcon className="h-4 w-4" /> New course
          </button>
        )
      }
    >
      {creating && (
        <form
          className="card mb-6 space-y-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const { data, error: err } = await supabaseBrowser()
              .from("courses")
              .insert({
                community_id: community.id,
                title: title.trim(),
                description: description.trim(),
                emoji: emoji.trim(),
                unlock_level: unlock,
                position: courses.length,
                created_by: me.id,
              })
              .select()
              .single();
            if (err) return setError("Couldn’t create the course.");
            router.push(`/c/${community.slug}/classroom/${(data as Course).id}`);
          }}
        >
          <h2 className="font-medium">New course</h2>
          <div className="grid grid-cols-[4rem_1fr] gap-3">
            <input className="input text-center" placeholder="📘" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} aria-label="Emoji" />
            <input className="input" placeholder="Course title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required aria-label="Course title" />
          </div>
          <textarea className="input min-h-[70px]" placeholder="What will people learn?" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} aria-label="Description" />
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
            Unlocks at
            <select className="input w-auto" value={unlock} onChange={(e) => setUnlock(Number(e.target.value))} aria-label="Unlock level">
              {Array.from({ length: 9 }, (_, i) => i + 1).map((l) => (
                <option key={l} value={l}>
                  {l === 1 ? "Level 1 (everyone)" : `Level ${l}`}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary">Create and add lessons</button>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">New courses start as drafts. Only admins see drafts until you publish.</p>
        </form>
      )}

      {courses.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">No courses yet</p>
          <p className="mt-1 text-sm text-muted">
            {isAdmin ? "Create the first one. Courses can unlock as members level up." : "When the admins publish a course, it shows up here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const pct = c.lesson_count ? Math.round((c.done_count / c.lesson_count) * 100) : 0;
            return (
              <Link
                key={c.id}
                href={c.locked ? "#" : `/c/${community.slug}/classroom/${c.id}`}
                aria-disabled={c.locked}
                onClick={(e) => c.locked && e.preventDefault()}
                className={`card group flex flex-col overflow-hidden transition-colors ${c.locked ? "cursor-not-allowed" : "hover:border-muted"}`}
              >
                <div className="relative flex h-32 items-center justify-center bg-raised text-5xl">
                  {c.emoji || "📘"}
                  {c.locked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg/80 text-sm font-medium backdrop-blur-[2px]">
                      <LockIcon className="h-5 w-5" />
                      Unlocks at Level {c.unlock_level}
                      {myLevel && <span className="text-xs font-normal text-muted">You’re Level {myLevel}</span>}
                    </div>
                  )}
                  {!c.published && <span className="absolute left-3 top-3 rounded bg-panel px-2 py-0.5 text-xs font-medium">Draft</span>}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="font-semibold">{c.title}</h2>
                  {c.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>}
                  <div className="mt-auto pt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {c.lesson_count === 0 ? "No lessons yet" : `${pct}% · ${c.done_count} of ${c.lesson_count} lessons`}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
