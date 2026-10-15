-- Ctrl Room — posts and follows: a public side next to the chat.
--
-- Profiles are public by default from here on: anyone signed in can see a person's name, photo and bio, follow them
-- and read their posts. A person can turn their public profile off (set_public_profile): then they're visible only to
-- people they share a community or a DM with, or who follow them, as before 0020 (0001, 0011), and their posts are
-- hidden. People write short posts (up to 500 characters), to their followers or into a public community they're in,
-- and follow people and public communities. The Feed (src/app/app/feed) has two tabs: Following (people you follow,
-- yourself, and public communities you're in or follow) and Everyone (every post you're allowed to see). A profile
-- (/u/<username>) shows someone's posts when you're allowed to see them.
--
--   Public profile, public account  anyone signed in sees their profile and posts; following is instant
--   Public profile, private account anyone signed in sees their profile; only approved followers see their posts;
--                                 following sends a request
--   Public profile turned off     their profile and posts are hidden again (posts stay, for when it's back on)
--   Community posts               only into a public community you're a member of; anyone signed in sees them while
--                                 it's public (members only if it's made private later)
--   Blocks (0011, either way)     no seeing each other's posts, no following, no liking or replying; blocking
--                                 removes follows both ways
--
-- Someone who follows you, or asked to, can see your name and photo (to approve them), whatever their own setting.
-- Community member lists, rooms and messages keep their own rules.
--
-- Everything that crosses a person boundary is a SECURITY DEFINER function that checks the caller: follow_user,
-- unfollow_user, remove_follower, answer_follow_request, set_private_account, follow_community, unfollow_community,
-- delete_post, report_post, set_public_profile, and the readers profile_view, my_follow_requests, feed_posts. Writing, editing (your own
-- body) and liking go through RLS. post_cards is a security_invoker view: it shows only rows the caller may read.
--
-- Flood guard: 30 posts an hour and 300 a day per person; 200 follows a day.

-- ───────────────────────── profiles ─────────────────────────

alter table public.profiles add column bio text not null default '' check (char_length(bio) <= 160);
alter table public.profiles add column is_private boolean not null default false;
alter table public.profiles add column public_profile boolean not null default true;

-- ───────────────────────── tables ─────────────────────────

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, status);

create table public.community_follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, community_id)
);
create index community_follows_community_idx on public.community_follows (community_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  reply_to uuid references public.posts (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index posts_created_idx on public.posts (created_at desc) where deleted_at is null;
create index posts_author_idx on public.posts (author_id, created_at desc) where deleted_at is null;
create index posts_community_idx on public.posts (community_id, created_at desc) where deleted_at is null and community_id is not null;
create index posts_reply_idx on public.posts (reply_to, created_at) where reply_to is not null;

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

-- Reports of posts go into the existing reports table (0003) for the operator's /admin, with a copy of the text.
alter table public.reports add column post_id uuid references public.posts (id) on delete set null;
alter table public.reports add column post_author_id uuid references public.profiles (id) on delete set null;
alter table public.reports add column post_snapshot text check (post_snapshot is null or char_length(post_snapshot) <= 1000);

-- ───────────────────────── helpers (used by policies; answer only about the caller) ─────────────────────────

-- The caller follows p_user and is approved.
create or replace function public.follows_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = (select auth.uid()) and followee_id = p_user and status = 'active')
$$;

-- The caller and p_user follow each other in either direction, approved or asked.
create or replace function public.follow_related(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.follows
    where (follower_id = (select auth.uid()) and followee_id = p_user) or (follower_id = p_user and followee_id = (select auth.uid()))
  )
$$;

-- May the caller see p_user's profile? Public profiles, or (turned off) the pre-0020 rules plus follows between them.
create or replace function public.can_see_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = (select auth.uid())
    or exists (select 1 from public.profiles where id = p_user and public_profile)
    or public.follow_related(p_user) or public.shares_community(p_user) or public.shares_dm(p_user)
$$;

-- May the caller see a post by p_author (in p_community, if any)? Never while the author's public profile is off.
create or replace function public.can_see_post(p_author uuid, p_community uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_author is null then return false; end if;
  if p_author = uid then return true; end if;
  if not coalesce((select public_profile from public.profiles where id = p_author), false) then return false; end if;
  if public.is_blocked_pair(uid, p_author) then return false; end if;
  if p_community is not null then
    return exists (select 1 from public.communities c where c.id = p_community and c.is_public) or public.is_member(p_community);
  end if;
  if not coalesce((select is_private from public.profiles where id = p_author), true) then return true; end if;
  return public.follows_user(p_author);
end $$;

-- ───────────────────────── triggers ─────────────────────────

-- New posts: the flood guard, and a reply goes where its post is visible (same community, if any).
create or replace function public.posts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent public.posts;
begin
  new.body := btrim(new.body);
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  if (select count(*) from public.posts where author_id = new.author_id and created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.posts where author_id = new.author_id and created_at > now() - interval '1 day') >= 300 then
    raise exception 'CR: You''ve posted a lot in a short time. Try again in a little while.';
  end if;
  if new.reply_to is not null then
    select * into parent from public.posts where id = new.reply_to;
    if not found or parent.deleted_at is not null then raise exception 'CR: That post was deleted.'; end if;
    if public.is_blocked_pair(new.author_id, parent.author_id) then raise exception 'CR: You can''t reply to this post.'; end if;
    new.community_id := parent.community_id;
  end if;
  return new;
end $$;
create trigger posts_before_insert before insert on public.posts for each row execute function public.posts_before_insert();

create or replace function public.posts_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.body is distinct from old.body then
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end $$;
create trigger posts_before_update before update on public.posts for each row execute function public.posts_before_update();

-- Blocking someone ends follows between you, both ways (0011 block_user inserts the block).
create or replace function public.blocks_drop_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id) or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
create trigger blocks_drop_follows after insert on public.blocks for each row execute function public.blocks_drop_follows();

-- ───────────────────────── row-level security ─────────────────────────

alter table public.follows enable row level security;
alter table public.community_follows enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;

-- A public profile is visible to everyone signed in; people who follow each other (or asked to) see each other.
create policy profiles_select_social on public.profiles for select to authenticated
  using (public_profile or public.follow_related(id));

-- Your own follows, both ways (counts and lists come from profile_view and my_follow_requests).
create policy follows_select on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy community_follows_select on public.community_follows for select to authenticated
  using (user_id = (select auth.uid()));

create policy posts_select on public.posts for select to authenticated
  using (deleted_at is null and public.can_see_post(author_id, community_id));
-- Write as yourself, with your public profile on: to your followers, or into a public community you're a member of.
-- Replies: to a post you can see (in a community, members reply).
create policy posts_insert on public.posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.public_profile)
    and (community_id is null or (public.is_member(community_id) and exists (select 1 from public.communities c where c.id = community_id and c.is_public)))
    and (posts.reply_to is null or exists (select 1 from public.posts p where p.id = posts.reply_to))
  );
-- Edit only your own live post's text. Deleting goes through delete_post.
create policy posts_update on public.posts for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null)
  with check (author_id = (select auth.uid()));

create policy post_likes_select on public.post_likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy post_likes_insert on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy post_likes_delete on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.follows, public.community_follows, public.posts, public.post_likes from anon, authenticated;
grant select on public.follows, public.community_follows to authenticated;
grant select (id, author_id, community_id, reply_to, body, created_at, edited_at) on public.posts to authenticated;
grant insert (author_id, community_id, reply_to, body) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant select, insert, delete on public.post_likes to authenticated;
-- Your own bio. Private or public goes through set_private_account (it approves waiting requests when you go public).
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, bio) on public.profiles to authenticated;
-- deleted_at is read by the policy, not by people: a deleted post simply isn't there.

-- Posts as the app shows them: author, community, likes and replies, and whether you liked it. Only rows you can read.
create view public.post_cards with (security_invoker = on) as
  select p.id, p.author_id, p.community_id, p.reply_to, p.body, p.created_at, p.edited_at,
         a.username as author_username, a.display_name as author_name, a.avatar_url as author_avatar, a.is_bot as author_is_bot,
         c.slug as community_slug, c.name as community_name, c.icon as community_icon,
         (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
         (select count(*) from public.posts r where r.reply_to = p.id)::int as reply_count,
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = (select auth.uid())) as liked
  from public.posts p
  join public.profiles a on a.id = p.author_id
  left join public.communities c on c.id = p.community_id;
revoke all on public.post_cards from anon, authenticated;
grant select on public.post_cards to authenticated;

-- ───────────────────────── functions people call ─────────────────────────

-- Follow someone: at once for a public account, a request for a private one. Returns 'active' or 'pending'.
create or replace function public.follow_user(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  st text;
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_user is null or p_user = uid then raise exception 'CR: You can''t follow yourself.'; end if;
  if not exists (select 1 from public.profiles where id = p_user and not is_bot and public_profile) then raise exception 'not found'; end if;
  if public.is_blocked_pair(uid, p_user) then raise exception 'CR: You can''t follow this account.'; end if;
  select status into st from public.follows where follower_id = uid and followee_id = p_user;
  if found then return st; end if;
  if (select count(*) from public.follows where follower_id = uid and created_at > now() - interval '1 day') >= 200 then
    raise exception 'CR: You''ve followed a lot of people today. Try again tomorrow.';
  end if;
  st := case when (select is_private from public.profiles where id = p_user) then 'pending' else 'active' end;
  insert into public.follows (follower_id, followee_id, status) values (uid, p_user, st);
  -- The person followed hears about it on their own topic (the app shows new followers and requests).
  perform realtime.send(jsonb_build_object('follower_id', uid, 'status', st), 'follow', 'user:' || p_user::text, true);
  return st;
end $$;

-- Unfollow, or take back a request.
create or replace function public.unfollow_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows where follower_id = (select auth.uid()) and followee_id = p_user;
end $$;

-- Stop someone following you (they aren't told).
create or replace function public.remove_follower(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows where followee_id = (select auth.uid()) and follower_id = p_user;
end $$;

create or replace function public.answer_follow_request(p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_accept then
    update public.follows set status = 'active' where followee_id = uid and follower_id = p_user and status = 'pending';
    if found then perform realtime.send(jsonb_build_object('by', uid), 'follow_approved', 'user:' || p_user::text, true); end if;
  else
    delete from public.follows where followee_id = uid and follower_id = p_user and status = 'pending';
  end if;
end $$;

-- Private: new followers need your approval and only followers see your posts. Going public approves every request.
create or replace function public.set_private_account(p_private boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  update public.profiles set is_private = coalesce(p_private, false) where id = uid;
  if not coalesce(p_private, false) then
    update public.follows set status = 'active' where followee_id = uid and status = 'pending';
  end if;
end $$;

-- Turn your public profile on or off (off hides your profile and posts again; your follows and posts are kept).
create or replace function public.set_public_profile(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  update public.profiles set public_profile = coalesce(p_on, false) where id = uid;
end $$;

-- Follow a public community's posts without joining it.
create or replace function public.follow_community(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.communities where id = p_community and is_public) then raise exception 'CR: Only public communities can be followed.'; end if;
  if exists (select 1 from public.bans where community_id = p_community and user_id = uid) then raise exception 'CR: You can''t follow this community.'; end if;
  insert into public.community_follows (user_id, community_id) values (uid, p_community) on conflict do nothing;
end $$;

create or replace function public.unfollow_community(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.community_follows where user_id = (select auth.uid()) and community_id = p_community;
end $$;

-- Delete a post: its author, or a mod (or higher) of the community it's in.
create or replace function public.delete_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  p public.posts;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into p from public.posts where id = p_post and deleted_at is null;
  if not found then return; end if;
  if p.author_id <> uid and not (p.community_id is not null and public.has_role(p.community_id, 'mod')) then
    raise exception 'CR: You can only delete your own posts.';
  end if;
  update public.posts set deleted_at = now() where id = p_post;
  delete from public.post_likes where post_id = p_post;
end $$;

create or replace function public.report_post(p_post uuid, p_reason text, p_details text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  p public.posts;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into p from public.posts where id = p_post and deleted_at is null;
  if not found or not public.can_see_post(p.author_id, p.community_id) then raise exception 'post not found'; end if;
  if p.author_id = uid then raise exception 'CR: You can''t report your own post.'; end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'CR: You''ve sent a lot of reports this hour. Try again later.';
  end if;
  insert into public.reports (community_id, reporter_id, reason, details, post_id, post_author_id, post_snapshot)
  values (p.community_id, uid, p_reason, substr(coalesce(p_details, ''), 1, 1000), p.id, p.author_id, p.body);
end $$;

-- ───────────────────────── readers ─────────────────────────

-- A profile page: who they are, counts, and where the caller stands with them.
create or replace function public.profile_view(p_username text)
returns table (id uuid, username text, display_name text, avatar_url text, bio text, is_private boolean, is_bot boolean,
               public_profile boolean, created_at timestamptz, followers int, following int, posts int,
               relation text, follows_you boolean, you_blocked boolean, can_see_posts boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  pr public.profiles;
begin
  if uid is null then return; end if;
  select * into pr from public.profiles p where p.username = lower(p_username);
  -- Only a profile the caller may see (public, or the 0001/0011 rules, or a follow between them): otherwise "not found".
  if not found or not public.can_see_profile(pr.id) then
    return;
  end if;
  return query select pr.id, pr.username, pr.display_name, pr.avatar_url, pr.bio, pr.is_private, pr.is_bot, pr.public_profile, pr.created_at,
    (select count(*) from public.follows f where f.followee_id = pr.id and f.status = 'active')::int,
    (select count(*) from public.follows f where f.follower_id = pr.id and f.status = 'active')::int,
    case when public.can_see_post(pr.id, null)
      then (select count(*) from public.posts q where q.author_id = pr.id and q.deleted_at is null and q.reply_to is null)::int end,
    case when pr.id = uid then 'self'
         else coalesce((select f.status from public.follows f where f.follower_id = uid and f.followee_id = pr.id), 'none') end,
    exists (select 1 from public.follows f where f.follower_id = pr.id and f.followee_id = uid and f.status = 'active'),
    exists (select 1 from public.blocks b where b.blocker_id = uid and b.blocked_id = pr.id),
    public.can_see_post(pr.id, null);
end $$;

-- People waiting for you to approve their follow, newest first.
create or replace function public.my_follow_requests()
returns table (id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f join public.profiles p on p.id = f.follower_id
  where f.followee_id = (select auth.uid()) and f.status = 'pending'
  order by f.created_at desc
$$;

-- The Feed, newest first, top-level posts only, p_limit (at most 50) older than p_before.
--   'following'  you, people you follow (approved), and public communities you're in or follow
--   'everyone'   every post you can see
create or replace function public.feed_posts(p_scope text default 'following', p_before timestamptz default null, p_limit int default 30)
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

-- ───────────────────────── privileges ─────────────────────────

-- New functions are executable by PUBLIC by default; open only what signed-in people call. follows_user and
-- can_see_post are used by the policies (they only answer about the caller).
revoke execute on function
  public.follows_user(uuid),
  public.follow_related(uuid),
  public.can_see_profile(uuid),
  public.can_see_post(uuid, uuid),
  public.posts_before_insert(),
  public.posts_before_update(),
  public.blocks_drop_follows(),
  public.follow_user(uuid),
  public.unfollow_user(uuid),
  public.remove_follower(uuid),
  public.answer_follow_request(uuid, boolean),
  public.set_private_account(boolean),
  public.set_public_profile(boolean),
  public.follow_community(uuid),
  public.unfollow_community(uuid),
  public.delete_post(uuid),
  public.report_post(uuid, text, text),
  public.profile_view(text),
  public.my_follow_requests(),
  public.feed_posts(text, timestamptz, int)
from public, anon, authenticated;

grant execute on function
  public.follows_user(uuid),
  public.follow_related(uuid),
  public.can_see_profile(uuid),
  public.can_see_post(uuid, uuid),
  public.follow_user(uuid),
  public.unfollow_user(uuid),
  public.remove_follower(uuid),
  public.answer_follow_request(uuid, boolean),
  public.set_private_account(boolean),
  public.set_public_profile(boolean),
  public.follow_community(uuid),
  public.unfollow_community(uuid),
  public.delete_post(uuid),
  public.report_post(uuid, text, text),
  public.profile_view(text),
  public.my_follow_requests(),
  public.feed_posts(text, timestamptz, int)
to authenticated;
