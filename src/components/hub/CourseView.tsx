"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCommunity } from "@/components/chat/CommunityContext";
import { CheckIcon, LockIcon, PlusIcon } from "@/components/chat/icons";
import { RichText } from "@/components/chat/RichText";
import { videoEmbed } from "@/lib/embed";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Course, type CourseModule, type LessonContent, type LessonRow } from "@/lib/types";
import { Page } from "./PageHeader";

export function CourseView({
  course: initialCourse,
  modules: initialModules,
  lessons: initialLessons,
  initialLessonId,
}: {
  course: Course;
  modules: CourseModule[];
  lessons: LessonRow[];
  initialLessonId: string | null;
}) {
  const { me, role, community, addPoints } = useCommunity();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const isAdmin = atLeast(role, "admin");
  const [course, setCourse] = useState(initialCourse);
  const [modules, setModules] = useState(initialModules);
  const [lessons, setLessons] = useState(initialLessons);
  const [current, setCurrent] = useState<string | null>(initialLessonId);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = modules.flatMap((m) => lessons.filter((l) => l.module_id === m.id).sort((a, b) => a.position - b.position));
  const lesson = lessons.find((l) => l.id === current) ?? null;
  const idx = lesson ? ordered.findIndex((l) => l.id === lesson.id) : -1;
  const next = idx >= 0 ? ordered.slice(idx + 1).find((l) => !l.locked) : undefined;
  const done = lessons.filter((l) => l.done).length;
  const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;

  const flash = (m: string) => {
    setError(m);
    setTimeout(() => setError(null), 4000);
  };

  const refreshLessons = useCallback(async () => {
    const { data } = await supabase.rpc("course_lessons", { p_course: course.id });
    setLessons((data ?? []) as LessonRow[]);
  }, [supabase, course.id]);

  useEffect(() => {
    if (!current) return setContent(null);
    let cancelled = false;
    setLoading(true);
    supabase
      .from("lesson_content")
      .select("*")
      .eq("lesson_id", current)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setContent((data as LessonContent) ?? null);
        setLoading(false);
      });
    window.history.replaceState(null, "", `?l=${current}`);
    return () => {
      cancelled = true;
    };
  }, [current, supabase]);

  const toggleDone = async () => {
    if (!lesson) return;
    const { error: err } = await supabase.rpc("complete_lesson", { p_lesson: lesson.id, p_done: !lesson.done });
    if (err) return flash("Couldn’t save your progress.");
    setLessons((list) => list.map((l) => (l.id === lesson.id ? { ...l, done: !l.done } : l)));
    const { data } = await supabase.from("community_members").select("points").eq("community_id", community.id).eq("user_id", me.id).single();
    if (data) addPoints({ [me.id]: (data as { points: number }).points });
    if (!lesson.done && next) setCurrent(next.id);
  };

  // ── admin helpers
  const updateCourse = async (patch: Partial<Course>) => {
    const { data, error: err } = await supabase.from("courses").update(patch).eq("id", course.id).select().single();
    if (err) return flash("Couldn’t update the course.");
    setCourse(data as Course);
    refreshLessons();
  };
  const addModule = async () => {
    const title = prompt("Section title (for example: Week 1)");
    if (!title?.trim()) return;
    const { data, error: err } = await supabase
      .from("course_modules")
      .insert({ course_id: course.id, title: title.trim(), position: modules.length })
      .select("id, course_id, title, position")
      .single();
    if (err) return flash("Couldn’t add the section.");
    setModules((m) => [...m, data as CourseModule]);
  };
  const addLesson = async (moduleId: string) => {
    const title = prompt("Lesson title");
    if (!title?.trim()) return;
    const { data, error: err } = await supabase
      .from("lessons")
      .insert({ course_id: course.id, module_id: moduleId, title: title.trim(), position: lessons.filter((l) => l.module_id === moduleId).length })
      .select("id")
      .single();
    if (err) return flash("Couldn’t add the lesson.");
    await supabase.from("lesson_content").insert({ lesson_id: (data as { id: string }).id, body: "" });
    await refreshLessons();
    setCurrent((data as { id: string }).id);
    setEditing(true);
  };

  return (
    <Page
      wide
      title={
        <Link href={`/c/${community.slug}/classroom`} className="hover:underline">
          ← Classroom
        </Link>
      }
    >
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-raised text-3xl">{course.emoji || "📘"}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{course.title}</h1>
          {course.description && <p className="mt-1 text-sm text-muted">{course.description}</p>}
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-raised">
              <div className="h-full bg-signal transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted">
              {pct}% complete{pct === 100 && lessons.length > 0 ? " 🎉" : ""}
            </span>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              className="input w-auto py-1.5"
              value={course.unlock_level}
              onChange={(e) => updateCourse({ unlock_level: Number(e.target.value) })}
              aria-label="Unlock level"
            >
              {Array.from({ length: 9 }, (_, i) => i + 1).map((l) => (
                <option key={l} value={l}>
                  Unlocks at Level {l}
                </option>
              ))}
            </select>
            <button className={course.published ? "btn-outline py-1.5" : "btn-primary py-1.5"} onClick={() => updateCourse({ published: !course.published })}>
              {course.published ? "Unpublish" : "Publish"}
            </button>
            <button
              className="btn-ghost py-1.5 text-alert"
              onClick={async () => {
                if (!confirm(`Delete “${course.title}” and all its lessons?`)) return;
                const { error: err } = await supabase.from("courses").delete().eq("id", course.id);
                if (err) return flash("Couldn’t delete the course.");
                router.push(`/c/${community.slug}/classroom`);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-alert" role="alert">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Lessons" className="card h-fit p-2">
          {modules.map((m) => (
            <div key={m.id} className="mb-2">
              <h2 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{m.title}</h2>
              <ul>
                {lessons
                  .filter((l) => l.module_id === m.id)
                  .sort((a, b) => a.position - b.position)
                  .map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => {
                          if (l.locked) return;
                          setCurrent(l.id);
                          setEditing(false);
                        }}
                        disabled={l.locked}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                          l.id === current ? "bg-raised font-medium" : "hover:bg-raised"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            l.done ? "border-signal bg-signal text-signal-fg" : "border-line"
                          }`}
                        >
                          {l.done ? <CheckIcon className="h-3 w-3" /> : l.locked ? <LockIcon className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        {l.locked && l.drip_days > 0 && (
                          <span className="shrink-0 text-[11px] text-muted">{new Date(l.opens_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        )}
                      </button>
                    </li>
                  ))}
              </ul>
              {isAdmin && (
                <button className="mt-1 flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-fg" onClick={() => addLesson(m.id)}>
                  <PlusIcon className="h-3.5 w-3.5" /> Add lesson
                </button>
              )}
            </div>
          ))}
          {modules.length === 0 && <p className="px-2 py-3 text-sm text-muted">No lessons yet.</p>}
          {isAdmin && (
            <button className="btn-outline mt-2 w-full py-1.5 text-xs" onClick={addModule}>
              <PlusIcon className="h-3.5 w-3.5" /> Add section
            </button>
          )}
        </nav>

        <section className="min-w-0">
          {!lesson ? (
            <div className="card p-10 text-center text-sm text-muted">{lessons.length ? "Pick a lesson to start." : "This course doesn’t have lessons yet."}</div>
          ) : editing && isAdmin ? (
            <LessonEditor
              lesson={lesson}
              content={content}
              onCancel={() => setEditing(false)}
              onSaved={async (c) => {
                setContent(c);
                setEditing(false);
                await refreshLessons();
              }}
              onDeleted={async () => {
                setCurrent(null);
                await refreshLessons();
              }}
              onError={flash}
            />
          ) : (
            <article className="card overflow-hidden">
              {loading ? (
                <p className="p-6 text-sm text-muted">Loading…</p>
              ) : (
                <>
                  {content?.video_url &&
                    (videoEmbed(content.video_url) ? (
                      <div className="aspect-video bg-black">
                        <iframe
                          src={videoEmbed(content.video_url)!}
                          title={lesson.title}
                          className="h-full w-full"
                          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      </div>
                    ) : (
                      <a href={content.video_url} target="_blank" rel="noopener noreferrer" className="block border-b border-line px-6 py-3 text-sm underline">
                        Watch the video ↗
                      </a>
                    ))}
                  <div className="p-6">
                    <div className="flex items-start gap-3">
                      <h2 className="flex-1 text-xl font-semibold">{lesson.title}</h2>
                      {isAdmin && (
                        <button className="btn-ghost py-1 text-xs" onClick={() => setEditing(true)}>
                          Edit lesson
                        </button>
                      )}
                    </div>
                    {content?.body ? (
                      <div className="mt-3 whitespace-pre-wrap break-words leading-relaxed">
                        <RichText body={content.body} myUsername={me.username} />
                      </div>
                    ) : (
                      !content?.video_url && <p className="mt-3 text-sm text-muted">{isAdmin ? "Add a video or notes with Edit lesson." : "Nothing here yet."}</p>
                    )}
                    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                      <button className={lesson.done ? "btn-outline" : "btn-primary"} onClick={toggleDone}>
                        <CheckIcon className="h-4 w-4" />
                        {lesson.done ? "Completed" : "Mark complete"}
                      </button>
                      {next && (
                        <button className="btn-ghost ml-auto" onClick={() => setCurrent(next.id)}>
                          Next: {next.title} →
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </article>
          )}
        </section>
      </div>
    </Page>
  );
}

function LessonEditor({
  lesson,
  content,
  onCancel,
  onSaved,
  onDeleted,
  onError,
}: {
  lesson: LessonRow;
  content: LessonContent | null;
  onCancel: () => void;
  onSaved: (c: LessonContent) => void;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
  const supabase = supabaseBrowser();
  const [title, setTitle] = useState(lesson.title);
  const [video, setVideo] = useState(content?.video_url ?? "");
  const [body, setBody] = useState(content?.body ?? "");
  const [drip, setDrip] = useState(lesson.drip_days);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card space-y-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const videoUrl = video.trim() || null;
        if (videoUrl && !videoUrl.startsWith("https://")) {
          setBusy(false);
          return onError("Video links must start with https://");
        }
        const [{ error: e1 }, { error: e2 }] = await Promise.all([
          supabase.from("lessons").update({ title: title.trim(), drip_days: drip }).eq("id", lesson.id),
          supabase.from("lesson_content").upsert({ lesson_id: lesson.id, body, video_url: videoUrl }),
        ]);
        setBusy(false);
        if (e1 || e2) return onError("Couldn’t save the lesson.");
        onSaved({ lesson_id: lesson.id, body, video_url: videoUrl });
      }}
    >
      <label className="label" htmlFor="lesson-title">
        Title
      </label>
      <input id="lesson-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
      <label className="label" htmlFor="lesson-video">
        Video link (YouTube, Vimeo or Loom)
      </label>
      <input id="lesson-video" className="input" type="url" placeholder="https://" value={video} onChange={(e) => setVideo(e.target.value)} />
      {video && !videoEmbed(video) && <p className="text-xs text-muted">This link will show as a button. YouTube, Vimeo and Loom links play right in the lesson.</p>}
      <label className="label" htmlFor="lesson-body">
        Notes
      </label>
      <textarea id="lesson-body" className="input min-h-[200px] font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} />
      <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Opens
        <input type="number" min={0} max={3650} className="input w-20" value={drip} onChange={(e) => setDrip(Math.max(0, Number(e.target.value) || 0))} aria-label="Days after joining" />
        days after someone joins (0 = right away)
      </label>
      <div className="flex gap-2 pt-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save lesson"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-ghost ml-auto text-alert"
          onClick={async () => {
            if (!confirm("Delete this lesson?")) return;
            const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
            if (error) return onError("Couldn’t delete the lesson.");
            onDeleted();
          }}
        >
          Delete lesson
        </button>
      </div>
    </form>
  );
}
