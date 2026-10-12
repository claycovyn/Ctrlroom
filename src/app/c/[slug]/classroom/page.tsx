import type { Metadata } from "next";
import { ClassroomView } from "@/components/hub/ClassroomView";
import { loadCommunity } from "@/lib/community";
import type { CourseCard } from "@/lib/types";

export const metadata: Metadata = { title: "Classroom" };

export default async function ClassroomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, community, role } = await loadCommunity(slug);
  if (!role) return null;
  const { data } = await supabase.rpc("course_overview", { p_community: community.id });
  return <ClassroomView courses={(data ?? []) as CourseCard[]} />;
}
