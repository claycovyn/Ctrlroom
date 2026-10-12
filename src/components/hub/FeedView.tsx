"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { useCommunity } from "@/components/chat/CommunityContext";
import { SearchIcon } from "@/components/chat/icons";
import { supabaseBrowser } from "@/lib/supabase/client";
import { atLeast, type Category, type Post } from "@/lib/types";
import { Page } from "./PageHeader";
import { PostCard } from "./PostCard";

const PAGE = 20;
type Sort = "activity" | "new" | "top";

export function FeedView({
  categories,
  initialPosts,
  initialLiked,
}: {
  categories: Category[];
  initialPosts: Post[];
  initialLiked: string[];
}) {
  const { me, role, community, ensureProfiles, refreshPoints, onCommunityEvent } = useCommunity();
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [liked, setLiked] = useState(() => new Set(initialLiked));
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("activity");
  const [more, setMore] = useState(initialPosts.length === PAGE);
  const [loading, setLoading] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState<Post[] | null>(null);

  // composer
  const postable = categories.filter((c) => atLeast(role, c.post_min_role));
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postCategory, setPostCategory] = useState(postable[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = Object.fromEntries(categories.map((c) => [c.id, c]));

  useEffect(() => {
    ensureProfiles([...new Set(initialPosts.map((p) => p.author_id))]);
  }, [initialPosts, ensureProfiles]);

  useEffect(
    () =>
      onCommunityEvent((event, p: { author_id: string }) => {
        if (event === "post" && p.author_id !== me.id) setFresh((n) => n + 1);
      }),
    [onCommunityEvent, me.id],
  );

  const load = async (opts: { reset?: boolean; cat?: string | null; order?: Sort } = {}) => {
    const cat = opts.cat !== undefined ? opts.cat : category;
    const order = opts.order ?? sort;
    const from = opts.reset ? 0 : posts.length;
    setLoading(true);
    let q = supabase.from("posts").select("*").eq("community_id", community.id).is("deleted_at", null);
    if (cat) q = q.eq("category_id", cat);
    if (order === "activity") q = q.order("pinned", { ascending: false }).order("last_activity_at", { ascending: false });
    else if (order === "new") q = q.order("created_at", { ascending: false });
    else q = q.order("like_count", { ascending: false }).order("created_at", { ascending: false });
    const { data } = await q.range(from, from + PAGE - 1);
    const list = (data ?? []) as Post[];
    ensureProfiles([...new Set(list.map((p) => p.author_id))]);
    if (list.length) {
      const { data: mine } = await supabase.from("post_likes").select("post_id").eq("user_id", me.id).in("post_id", list.map((p) => p.id));
      setLiked((s) => new Set([...(opts.reset ? [] : s), ...((mine ?? []) as { post_id: string }[]).map((r) => r.post_id)]));
    }
    setPosts((cur) => (opts.reset ? list : [...cur, ...list.filter((p) => !cur.some((c) => c.id === p.id))]));
    setMore(list.length === PAGE);
    setLoading(false);
    if (opts.reset) setFresh(0);
  };

  const toggleLike = async (post: Post) => {
    const was = liked.has(post.id);
    const bump = (d: number) => {
      const apply = (list: Post[]) => list.map((p) => (p.id === post.id ? { ...p, like_count: Math.max(0, p.like_count + d) } : p));
      setPosts(apply);
      setSearching((s) => (s ? apply(s) : s));
    };
    setLiked((s) => {
      const n = new Set(s);
      if (was) n.delete(post.id);
      else n.add(post.id);
      return n;
    });
    bump(was ? -1 : 1);
    const { error: err } = was
      ? await supabase.from("post_likes").delete().match({ post_id: post.id, user_id: me.id })
      : await supabase.from("post_likes").insert({ post_id: post.id, user_id: me.id });
    if (!err) refreshPoints([post.author_id]);
    if (err) {
      bump(was ? 1 : -1);
      setLiked((s) => {
        const n = new Set(s);
        if (was) n.add(post.id);
        else n.delete(post.id);
        return n;
      });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("posts")
      .insert({ community_id: community.id, category_id: postCategory || null, author_id: me.id, title: title.trim(), body: body.trim() })
      .select()
      .single();
    setBusy(false);
    if (err) return setError("Couldn’t post that. Try again.");
    setTitle("");
    setBody("");
    setWriting(false);
    router.push(`/c/${community.slug}/feed/${(data as Post).id}`);
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return setSearching(null);
    const { data } = await supabase.rpc("search_posts", { p_community: community.id, p_query: query.trim(), p_limit: 30 });
    const list = (data ?? []) as Post[];
    ensureProfiles([...new Set(list.map((p) => p.author_id))]);
    setSearching(list);
  };

  const shown = searching ?? posts;

  return (
    <Page title="Feed">
      {/* composer */}
      <div className="card mb-5 p-4">
        {!writing ? (
          <button className="flex w-full items-center gap-3 text-left" onClick={() => setWriting(true)}>
            <Avatar profile={me} size={36} />
            <span className="flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-muted">Write something…</span>
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              className="input text-base font-medium"
              placeholder="Title"
              value={title}
              maxLength={200}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              required
              aria-label="Post title"
            />
            <textarea
              className="input min-h-[120px] resize-y"
              placeholder="Share an update, ask a question or post a win. @mention people to loop them in."
              value={body}
              maxLength={20000}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Post body"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={postCategory} onChange={(e) => setPostCategory(e.target.value)} aria-label="Category">
                {postable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
              {error && <span className="text-sm text-alert">{error}</span>}
              <div className="ml-auto flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => setWriting(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy || !title.trim()}>
                  {busy ? "Posting…" : "Post"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[{ id: null, label: "All" }, ...categories.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}` }))].map((c) => (
            <button
              key={c.id ?? "all"}
              onClick={() => {
                setCategory(c.id);
                setSearching(null);
                load({ reset: true, cat: c.id });
              }}
              className={`rounded-full px-3 py-1 text-sm ${category === c.id ? "bg-signal text-signal-fg" : "bg-raised text-muted hover:text-fg"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select
          className="ml-auto rounded-md border border-line bg-panel px-2 py-1 text-sm"
          value={sort}
          onChange={(e) => {
            const v = e.target.value as Sort;
            setSort(v);
            setSearching(null);
            load({ reset: true, order: v });
          }}
          aria-label="Sort posts"
        >
          <option value="activity">Latest activity</option>
          <option value="new">Newest</option>
          <option value="top">Most liked</option>
        </select>
      </div>

      <form onSubmit={search} className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 focus-within:border-signal">
        <SearchIcon className="h-4 w-4 text-muted" />
        <input
          className="w-full bg-transparent py-2 text-sm focus:outline-none"
          placeholder="Search posts"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) setSearching(null);
          }}
          aria-label="Search posts"
        />
      </form>

      {fresh > 0 && !searching && (
        <button className="btn-primary mx-auto mb-4 flex" onClick={() => load({ reset: true })}>
          {fresh === 1 ? "1 new post" : `${fresh} new posts`} · show
        </button>
      )}

      {searching && (
        <p className="mb-3 text-sm text-muted">
          {searching.length} {searching.length === 1 ? "result" : "results"} for “{query}”{" "}
          <button className="underline" onClick={() => setSearching(null)}>
            Clear
          </button>
        </p>
      )}

      <div className="space-y-3">
        {shown.map((p) => (
          <PostCard key={p.id} post={p} category={p.category_id ? byId[p.category_id] : undefined} liked={liked.has(p.id)} onLike={() => toggleLike(p)} />
        ))}
      </div>

      {shown.length === 0 && !loading && (
        <div className="card p-8 text-center">
          <p className="font-medium">{searching ? "No posts match that." : "No posts yet."}</p>
          {!searching && <p className="mt-1 text-sm text-muted">Start things off: introduce yourself, or ask the first question.</p>}
        </div>
      )}

      {more && !searching && (
        <div className="py-6 text-center">
          <button className="btn-outline" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </Page>
  );
}
