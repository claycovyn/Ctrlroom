import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { CourseView } from "@/components/hub/CourseView";
import { loadCommunity } from "@/lib/community";
import type { Course, CourseModule, LessonRow } from "@/lib/types";

export const metadata: Metadata = { title: "Course" };

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; course: string }>;
  searchParams: Promise<{ l?: string }>;
}) {
  const [{ slug, course: courseId }, { l }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) notFound();
  const { supabase, community, role } = await loadCommunity(slug);
  if (!role) return null;

  const { data: course } = await supabase.from("courses").select("*").eq("id", courseId).eq("community_id", community.id).maybeSingle();
  if (!course) notFound();
  const { data: open } = await supabase.rpc("can_access_course", { p_course: courseId });
  if (!open) redirect(`/c/${slug}/classroom`);

  const [{ data: modules }, { data: lessons }] = await Promise.all([
    supabase.from("course_modules").select("id, course_id, title, position").eq("course_id", courseId).order("position"),
    supabase.rpc("course_lessons", { p_course: courseId }),
  ]);
  const rows = (lessons ?? []) as LessonRow[];
  const mods = (modules ?? []) as CourseModule[];
  const ordered = mods.flatMap((m) => rows.filter((r) => r.module_id === m.id).sort((a, b) => a.position - b.position));
  const requested = l && rows.find((r) => r.id === l && !r.locked);
  const start = requested || ordered.find((r) => !r.locked && !r.done) || ordered.find((r) => !r.locked);

  return <CourseView key={courseId} course={course as Course} modules={mods} lessons={rows} initialLessonId={start ? start.id : null} />;
}
