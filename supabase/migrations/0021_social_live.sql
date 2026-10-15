-- Ctrl Room — the Feed, live and with media: photos and videos in posts, live events, activity, follower lists.
--
-- Photos and videos (up to 4 per post) live in a PRIVATE Storage bucket `post-media`; nothing in it is public.
--   1. create_post_media() reserves a row (pending: no post yet) and picks the path: post/<your id>/<media id>/media.<ext>
--   2. The browser uploads to that exact path. Storage only accepts it while the pending row is yours.
--   3. publish_post() writes the post (through the posts RLS) and links your pending, uploaded files to it, in one
--      transaction. A post needs text or at least one file (checked when the transaction commits).
--   Reading a file: the people who can see its post (posts RLS, 0020), and you for your pending files. Pending files
--   nobody posted after 24 hours, and files of deleted posts, are removed by the daily cron (post_media_cleanup).
--   Limits: photos (PNG, JPEG, WebP, GIF) up to 10 MB, videos (MP4, WebM) up to 50 MB; 8 pending files and 60 new
--   files an hour per person. SVG and HTML are never accepted.
--
-- Live (Realtime broadcast from the database, as in 0001):
--   posts:public        any signed-in person may listen. `post` { id, author_id, community_id } for each new top-level
--                       post anyone signed in may see (a public account, outside a community or in a public one). The
--                       app fetches the post through post_cards, so RLS still decides.
--   user:<id>           `post` for each new top-level post of a private account you follow; `post_reply` { post_id,
--                       reply_id, by } when someone replies to your post; `post_like` { post_id, by } when someone likes
--                       it; `follow` and `follow_approved` (0020).
--
-- Activity: my_activity() lists new followers and requests, likes and replies on your posts (from people you may
-- see), newest first; my_activity_unseen() counts what came since mark_activity_seen() (social_seen, yours only).
--
-- Follower lists: profile_follows(username, 'followers' | 'following') for a profile you can see, when its posts are
-- visible to you (a private account's lists are for its approved followers), listing only people you may see.

-- ───────────────────────── posts with media ─────────────────────────

-- A post's text may be empty when it has a photo or video (posts_need_content checks at commit).
alter table public.posts drop constraint posts_body_check;
alter table public.posts add constraint posts_body_check check (char_length(btrim(body)) <= 500);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  path text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')),
  size_bytes bigint not null check (size_bytes > 0),
  width int check (width is null or width between 1 and 20000),
  height int check (height is null or height between 1 and 20000),
  alt text not null default '' check (char_length(alt) <= 300),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index post_media_post_idx on public.post_media (post_id, position) where post_id is not null;
create index post_media_pending_idx on public.post_media (uploader_id, created_at) where post_id is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

create or replace function public.post_media_ext(p_mime text) returns text
language sql immutable as $$
  select case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'image/gif' then 'gif'
                     when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end
$$;

create or replace function public.post_media_max_bytes(p_mime text) returns bigint
language sql immutable as $$
  select case when p_mime like 'video/%' then 52428800 else 10485760 end::bigint
$$;

-- Reserve a photo or video for your next post; returns where to upload it.
create or replace function public.create_post_media(p_mime text, p_size bigint, p_width int default null, p_height int default null, p_alt text default '')
returns table (id uuid, path text)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  mid uuid := gen_random_uuid();
  p text;
begin
  if uid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where profiles.id = uid and public_profile) then raise exception 'CR: Turn on your public profile to post.'; end if;
  if public.post_media_ext(p_mime) is null then raise exception 'CR: Posts take photos (PNG, JPEG, WebP, GIF) and videos (MP4, WebM).'; end if;
  if p_size is null or p_size <= 0 or p_size > public.post_media_max_bytes(p_mime) then
    raise exception 'CR: Photos can be up to 10 MB and videos up to 50 MB.';
  end if;
  if (select count(*) from public.post_media m where m.uploader_id = uid and m.post_id is null) >= 8 then
    raise exception 'CR: Post or remove the photos and videos you added first.';
  end if;
  if (select count(*) from public.post_media m where m.uploader_id = uid and m.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'CR: You''ve added a lot of photos and videos this hour. Try again later.';
  end if;
  p := 'post/' || uid::text || '/' || mid::text || '/media.' || public.post_media_ext(p_mime);
  insert into public.post_media (id, uploader_id, path, mime, size_bytes, width, height, alt)
  values (mid, uid, p, p_mime, p_size, p_width, p_height, substr(btrim(coalesce(p_alt, '')), 1, 300));
  return query select mid, p;
end $$;

-- Remove a photo or video you added but haven't posted (the app removes its bytes; the cron does if it doesn't).
create or replace function public.remove_post_media(p_media uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_media where id = p_media and uploader_id = (select auth.uid()) and post_id is null;
end $$;

-- Storage: upload only to your own pending path; read files of posts you can see, and your pending ones.
create or replace function public.can_upload_post_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.post_media where path = p_name and uploader_id = (select auth.uid()) and post_id is null)
$$;

create or replace function public.can_read_post_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.post_media m
    left join public.posts p on p.id = m.post_id
    where m.path = p_name
      and ((m.post_id is null and m.uploader_id = (select auth.uid()))
        or (p.id is not null and p.deleted_at is null and public.can_see_post(p.author_id, p.community_id)))
  )
$$;

create policy post_media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and public.can_read_post_media(name));
create policy post_media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and public.can_upload_post_media(name));
create policy post_media_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'post-media' and public.can_upload_post_media(name))
  with check (bucket_id = 'post-media' and public.can_upload_post_media(name));
create policy post_media_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and public.can_upload_post_media(name));

alter table public.post_media enable row level security;
create policy post_media_select on public.post_media for select to authenticated
  using ((post_id is null and uploader_id = (select auth.uid())) or (post_id is not null and exists (select 1 from public.posts p where p.id = post_id)));
revoke all on public.post_media from anon, authenticated;
grant select on public.post_media to authenticated;

-- Internal (called by publish_post): links the caller's pending, uploaded files to their post just written, in order.
create or replace function public.attach_post_media(p_post uuid, p_media uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  n int := coalesce(array_length(p_media, 1), 0);
  linked int;
begin
  if n = 0 then return; end if;
  if not exists (select 1 from public.posts where id = p_post and author_id = uid and deleted_at is null)
     or exists (select 1 from public.post_media where post_id = p_post) then
    raise exception 'post not found';
  end if;
  update public.post_media m set post_id = p_post, position = x.ord - 1
  from unnest(p_media) with ordinality as x(id, ord)
  where m.id = x.id and m.uploader_id = uid and m.post_id is null
    and exists (select 1 from storage.objects o where o.bucket_id = 'post-media' and o.name = m.path);
  get diagnostics linked = row_count;
  if linked <> n then raise exception 'CR: A photo or video didn''t finish uploading. Try again.'; end if;
end $$;

-- Write a post with photos or videos (up to 4). The post goes through the posts RLS as a normal insert would.
create or replace function public.publish_post(p_body text default '', p_community uuid default null, p_reply_to uuid default null, p_media uuid[] default '{}')
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  pid uuid;
  n int := coalesce(array_length(p_media, 1), 0);
begin
  if n > 4 then raise exception 'CR: A post can have up to 4 photos or videos.'; end if;
  if btrim(coalesce(p_body, '')) = '' and n = 0 then raise exception 'CR: Write something, or add a photo or video.'; end if;
  insert into public.posts (author_id, body, community_id, reply_to)
  values ((select auth.uid()), coalesce(p_body, ''), p_community, p_reply_to)
  returning id into pid;
  perform public.attach_post_media(pid, p_media);
  return pid;
end $$;

-- At commit: a post has text or at least one file (a plain insert with empty text is refused).
create or replace function public.posts_need_content() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if btrim(new.body) = '' and not exists (select 1 from public.post_media where post_id = new.id) then
    raise exception 'CR: Write something, or add a photo or video.';
  end if;
  return null;
end $$;
create constraint trigger posts_need_content after insert on public.posts
  deferrable initially deferred for each row execute function public.posts_need_content();

-- Posts as the app shows them, now with their photos and videos (in order).
create or replace view public.post_cards with (security_invoker = on) as
  select p.id, p.author_id, p.community_id, p.reply_to, p.body, p.created_at, p.edited_at,
         a.username as author_username, a.display_name as author_name, a.avatar_url as author_avatar, a.is_bot as author_is_bot,
         c.slug as community_slug, c.name as community_name, c.icon as community_icon,
         (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
         (select count(*) from public.posts r where r.reply_to = p.id)::int as reply_count,
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = (select auth.uid())) as liked,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path, 'mime', m.mime, 'width', m.width, 'height', m.height, 'alt', m.alt) order by m.position)
                   from public.post_media m where m.post_id = p.id), '[]'::jsonb) as media
  from public.posts p
  join public.profiles a on a.id = p.author_id
  left join public.communities c on c.id = p.community_id;
revoke all on public.post_cards from anon, authenticated;
grant select on public.post_cards to authenticated;

-- feed_posts returns post_cards rows; recreated so its row type has the new column.
drop function public.feed_posts(text, timestamptz, int);
create function public.feed_posts(p_scope text default 'following', p_before timestamptz default null, p_limit int default 30)
returns setof public.post_cards
language sql stable security invoker set search_path = public as $$
  select c.* from public.post_cards c
  where c.reply_to is null
    and c.created_at < coalesce(p_before, 'infinity'::timestamptz)
    and (
      p_scope = 'everyone'
      or c.author_id = (select auth.uid())
      or c.author_id in (select f.followee_id from public.follows f where f.follower_id = (select auth.uid()) and f.status = 'active')
      or c.community_id in (select m.community_id from public.community_members m where m.user_id = (select auth.uid()))
      or c.community_id in (select cf.community_id from public.community_follows cf where cf.user_id = (select auth.uid()))
    )
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- Daily, from the cron (service role): files to remove from Storage: pending for over 24 hours, or of deleted posts.
-- post_media_cleanup_done() drops their rows once the bytes are gone.
create or replace function public.post_media_cleanup(p_limit int default 500) returns table (path text)
language sql stable security definer set search_path = public as $$
  select m.path from public.post_media m left join public.posts p on p.id = m.post_id
  where (m.post_id is null and m.created_at < now() - interval '24 hours') or p.deleted_at is not null
  order by m.created_at limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;
create or replace function public.post_media_cleanup_done(p_paths text[]) returns void
language sql security definer set search_path = public as $$
  delete from public.post_media m using public.post_media x left join public.posts p on p.id = x.post_id
  where m.id = x.id and x.path = any (p_paths)
    and ((x.post_id is null and x.created_at < now() - interval '24 hours') or p.deleted_at is not null)
$$;

-- ───────────────────────── live ─────────────────────────

-- 0001's topic check, plus posts:public for everyone signed in.
create or replace function public.can_use_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_topic is null then return false; end if;
  if p_topic ~ '^room:[0-9a-f-]{36}$' then
    return exists (select 1 from public.rooms r where r.id = substr(p_topic, 6)::uuid and public.is_member(r.community_id));
  elsif p_topic ~ '^community:[0-9a-f-]{36}$' then
    return public.is_member(substr(p_topic, 11)::uuid);
  elsif p_topic ~ '^user:[0-9a-f-]{36}$' then
    return substr(p_topic, 6)::uuid = uid;
  elsif p_topic = 'posts:public' then
    return true;
  end if;
  return false;
end $$;

create or replace function public.posts_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author public.profiles;
  parent_author uuid;
  payload jsonb := jsonb_build_object('id', new.id, 'author_id', new.author_id, 'community_id', new.community_id);
  f record;
begin
  select * into author from public.profiles where id = new.author_id;
  if new.reply_to is not null then
    select p.author_id into parent_author from public.posts p where p.id = new.reply_to;
    if parent_author is not null and parent_author <> new.author_id then
      perform realtime.send(jsonb_build_object('post_id', new.reply_to, 'reply_id', new.id, 'by', new.author_id), 'post_reply', 'user:' || parent_author::text, true);
    end if;
    return null;
  end if;
  if not author.public_profile then return null; end if;
  if new.community_id is not null then
    if exists (select 1 from public.communities c where c.id = new.community_id and c.is_public) then
      perform realtime.send(payload, 'post', 'posts:public', true);
    end if;
  elsif not author.is_private then
    perform realtime.send(payload, 'post', 'posts:public', true);
  else
    -- A private account: only its approved followers hear about it (at most 5,000 of them, most recent first).
    for f in select follower_id from public.follows where followee_id = new.author_id and status = 'active' order by created_at desc limit 5000 loop
      perform realtime.send(payload, 'post', 'user:' || f.follower_id::text, true);
    end loop;
  end if;
  return null;
end $$;
create trigger posts_after_insert after insert on public.posts for each row execute function public.posts_after_insert();

create or replace function public.post_likes_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = new.post_id;
  if author is not null and author <> new.user_id then
    perform realtime.send(jsonb_build_object('post_id', new.post_id, 'by', new.user_id), 'post_like', 'user:' || author::text, true);
  end if;
  return null;
end $$;
create trigger post_likes_after_insert after insert on public.post_likes for each row execute function public.post_likes_after_insert();

-- ───────────────────────── activity ─────────────────────────

-- When a follow request was approved, so the person who asked sees it in their activity.
alter table public.follows add column accepted_at timestamptz;
create or replace function public.follows_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'active' then new.accepted_at := now(); end if;
  return new;
end $$;
create trigger follows_before_update before update on public.follows for each row execute function public.follows_before_update();

create table public.social_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.social_seen enable row level security;
create policy social_seen_select on public.social_seen for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.social_seen from anon, authenticated;
grant select on public.social_seen to authenticated;

-- New followers and requests, approved requests of yours, likes and replies on your posts, from people you may see, newest first (at most 100).
create or replace function public.my_activity(p_limit int default 50)
returns table (kind text, at timestamptz, actor_id uuid, actor_username text, actor_name text, actor_avatar text, post_id uuid, excerpt text)
language sql stable security definer set search_path = public as $$
  with me as (select (select auth.uid()) as id),
  items as (
    select case f.status when 'pending' then 'request' else 'follow' end as kind, f.created_at as at, f.follower_id as actor, null::uuid as post_id, null::text as excerpt
    from public.follows f, me where f.followee_id = me.id
    union all
    select 'approved', f.accepted_at, f.followee_id, null, null
    from public.follows f, me where f.follower_id = me.id and f.status = 'active' and f.accepted_at is not null
    union all
    select 'like', l.created_at, l.user_id, p.id, left(p.body, 120)
    from public.post_likes l join public.posts p on p.id = l.post_id, me
    where p.author_id = me.id and p.deleted_at is null and l.user_id <> me.id
    union all
    select 'reply', r.created_at, r.author_id, r.id, left(r.body, 120)
    from public.posts r join public.posts p on p.id = r.reply_to, me
    where p.author_id = me.id and r.author_id <> me.id and r.deleted_at is null and public.can_see_post(r.author_id, r.community_id)
  )
  select i.kind, i.at, a.id, a.username, a.display_name, a.avatar_url, i.post_id, i.excerpt
  from items i join public.profiles a on a.id = i.actor
  where public.can_see_profile(a.id) and not public.is_blocked_pair((select auth.uid()), a.id)
  order by i.at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- How many activity items came since you last looked.
create or replace function public.my_activity_unseen() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.my_activity(100) a
  where a.at > coalesce((select seen_at from public.social_seen where user_id = (select auth.uid())), '-infinity'::timestamptz)
$$;

create or replace function public.mark_activity_seen() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  insert into public.social_seen (user_id, seen_at) values (uid, now()) on conflict (user_id) do update set seen_at = now();
end $$;

-- ───────────────────────── follower lists ─────────────────────────

create or replace function public.profile_follows(p_username text, p_which text, p_before timestamptz default null, p_limit int default 50)
returns table (id uuid, username text, display_name text, avatar_url text, bio text, followed_at timestamptz, relation text)
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  target public.profiles;
begin
  if uid is null or p_which not in ('followers', 'following') then return; end if;
  select * into target from public.profiles p where p.username = lower(p_username);
  if not found or not public.can_see_profile(target.id) then return; end if;
  -- A private account's lists are for itself and its approved followers; a hidden profile's for itself.
  if target.id <> uid and (not target.public_profile or (target.is_private and not public.follows_user(target.id))) then return; end if;
  return query
    select o.id, o.username, o.display_name, o.avatar_url, o.bio, f.created_at,
           case when o.id = uid then 'self'
                else coalesce((select g.status from public.follows g where g.follower_id = uid and g.followee_id = o.id), 'none') end
    from public.follows f
    join public.profiles o on o.id = case when p_which = 'followers' then f.follower_id else f.followee_id end
    where f.status = 'active'
      and (case when p_which = 'followers' then f.followee_id else f.follower_id end) = target.id
      and f.created_at < coalesce(p_before, 'infinity'::timestamptz)
      and public.can_see_profile(o.id)
      and not public.is_blocked_pair(uid, o.id)
    order by f.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ───────────────────────── privileges ─────────────────────────

revoke execute on function
  public.post_media_ext(text),
  public.post_media_max_bytes(text),
  public.create_post_media(text, bigint, int, int, text),
  public.remove_post_media(uuid),
  public.can_upload_post_media(text),
  public.can_read_post_media(text),
  public.attach_post_media(uuid, uuid[]),
  public.publish_post(text, uuid, uuid, uuid[]),
  public.posts_need_content(),
  public.feed_posts(text, timestamptz, int),
  public.post_media_cleanup(int),
  public.post_media_cleanup_done(text[]),
  public.posts_after_insert(),
  public.post_likes_after_insert(),
  public.follows_before_update(),
  public.my_activity(int),
  public.my_activity_unseen(),
  public.mark_activity_seen(),
  public.profile_follows(text, text, timestamptz, int)
from public, anon, authenticated;

grant execute on function
  public.post_media_ext(text),
  public.post_media_max_bytes(text),
  public.create_post_media(text, bigint, int, int, text),
  public.remove_post_media(uuid),
  public.can_upload_post_media(text),
  public.can_read_post_media(text),
  public.attach_post_media(uuid, uuid[]),
  public.publish_post(text, uuid, uuid, uuid[]),
  public.feed_posts(text, timestamptz, int),
  public.my_activity(int),
  public.my_activity_unseen(),
  public.mark_activity_seen(),
  public.profile_follows(text, text, timestamptz, int)
to authenticated;

grant execute on function public.post_media_cleanup(int), public.post_media_cleanup_done(text[]) to service_role;
