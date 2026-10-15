"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PostCard } from "@/lib/social";
import { Composer } from "./Composer";
import { PostItem } from "./PostItem";
import { PostList } from "./PostList";

/** One post with the post it answers (if any) above, and its replies below with a reply box. */
export function ThreadView({ me, parent, post: initial, initialReplies }: { me: { id: string; username: string; public_profile: boolean }; parent: PostCard | null; post: PostCard; initialReplies: PostCard[] }) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [replies, setReplies] = useState(initialReplies);
  return (
    <main className="mx-auto max-w-2xl border-x border-line">
      <h1 className="sr-only">Post by {post.author_name}</h1>
      {parent && (
        <div className="border-b border-line bg-raised/40 px-4 py-2 text-sm text-muted">
          Replying to{" "}
          <Link href={`/app/feed/post/${parent.id}`} className="font-medium text-fg hover:underline">
            {parent.author_name}&apos;s post
          </Link>
        </div>
      )}
      <PostItem post={post} me={me} onChange={setPost} onDeleted={() => router.push("/app/feed")} linkToThread={false} />
      {me.public_profile ? (
        <Composer me={me} replyTo={post.id} placeholder={`Reply to ${post.author_name}`} onPosted={(p) => setReplies((list) => [...list, p])} />
      ) : (
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          <Link href="/app/feed" className="font-medium text-fg underline">
            Turn on your public profile
          </Link>{" "}
          to reply.
        </p>
      )}
      <h2 className="sr-only">Replies</h2>
      <PostList me={me} posts={replies} setPosts={(fn) => setReplies(fn)} empty="No replies yet." />
    </main>
  );
}
