import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PostView } from "@/components/hub/PostView";
import { loadCommunity } from "@/lib/community";
import type { Category, Comment, Post } from "@/lib/types";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ slug: string; post: string }> }) {
  const { slug, post: postId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(postId)) notFound();
  const { supabase, user, community, role } = await loadCommunity(slug);
  if (!role) return null;

  const [{ data: post }, { data: categories }, { data: comments }] = await Promise.all([
    supabase.from("posts").select("*").eq("id", postId).eq("community_id", community.id).maybeSingle(),
    supabase.from("post_categories").select("*").eq("community_id", community.id).order("position"),
    supabase.from("post_comments").select("*").eq("post_id", postId).order("created_at").limit(1000),
  ]);
  if (!post) notFound();
  const commentIds = ((comments ?? []) as Comment[]).map((c) => c.id);
  const [{ data: postLike }, { data: commentLikes }, { data: author }] = await Promise.all([
    supabase.from("post_likes").select("post_id").eq("post_id", postId).eq("user_id", user.id),
    commentIds.length
      ? supabase.from("comment_likes").select("comment_id").eq("user_id", user.id).in("comment_id", commentIds)
      : Promise.resolve({ data: [] }),
    supabase.from("community_members").select("role").eq("community_id", community.id).eq("user_id", (post as Post).author_id).maybeSingle(),
  ]);
  const cats = (categories ?? []) as Category[];

  return (
    <PostView
      key={postId}
      initialPost={post as Post}
      category={cats.find((c) => c.id === (post as Post).category_id) ?? null}
      categories={cats}
      initialComments={(comments ?? []) as Comment[]}
      initialLiked={[
        ...((postLike ?? []) as { post_id: string }[]).map((r) => r.post_id),
        ...((commentLikes ?? []) as { comment_id: string }[]).map((r) => r.comment_id),
      ]}
      authorRole={author?.role ?? null}
    />
  );
}
