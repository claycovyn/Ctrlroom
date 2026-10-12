-- Ctrl Room — community hub: feed, classroom, calendar, points and levels.
--
-- Takes the parts people like about course-and-community platforms (a post feed with
-- categories, levels that unlock courses, a calendar) and fixes the common complaints:
--   * Points can't be farmed. Likes count once per person per day, and points also come
--     from finishing lessons and from answers marked helpful, not just from posting.
--   * Courses can unlock by level and/or days after joining, and track progress per lesson.
--   * Events link to a voice room, so the call happens right here.
-- Same rules as 0001: RLS is the permission system; cross-boundary writes are
-- SECURITY DEFINER functions that check the caller's role.

-- ───────────────────────── points & levels ─────────────────────────

alter table public.community_members add column points int not null default 0;

-- Nine levels, same curve communities already know: 0, 5, 20, 65, 155, 515, 2015, 8015, 33015.
create or replace function public.level_for(p int) returns int
language sql immutable as $$
  select case
    when p >= 33015 then 9 when p >= 8015 then 8 when p >= 2015 then 7 when p >= 515 then 6
    when p >= 155 then 5 when p >= 65 then 4 when p >= 20 then 3 when p >= 5 then 2 else 1 end
$$;

create or replace function public.level_floor(lvl int) returns int
language sql immutable as $$
  select (array[0, 5, 20, 65, 155, 515, 2015, 8015, 33015])[greatest(1, least(lvl, 9))]
$$;

create table public.points_ledger (
  id bigserial primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount int not null check (amount between 1 and 10),
  reason text not null check (reason in ('like', 'lesson', 'answer')),
  giver_id uuid references public.profiles (id) on delete set null,
  source_id uuid,
  day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
-- Anti-farming: one like-point per giver → receiver per day, however many likes.
create unique index points_like_daily on public.points_ledger (community_id, user_id, giver_id, day) where reason = 'like';
-- A lesson or an accepted answer pays out once.
create unique index points_once on public.points_ledger (community_id, user_id, reason, source_id) where reason in ('lesson', 'answer');
create index points_ledger_window on public.points_ledger (community_id, created_at desc);

create or replace function public.points_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.community_members set points = points + new.amount
  where community_id = new.community_id and user_id = new.user_id;
  return new;
end $$;

create trigger points_after_insert after insert on public.points_ledger
  for each row execute function public.points_after_insert();

create or replace function public.award(p_community uuid, p_user uuid, p_amount int, p_reason text, p_giver uuid, p_source uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_giver then return; end if;
  if not exists (select 1 from public.community_members where community_id = p_community and user_id = p_user) then return; end if;
  insert into public.points_ledger (community_id, user_id, amount, reason, giver_id, source_id)
  values (p_community, p_user, p_amount, p_reason, p_giver, p_source)
  on conflict do nothing;
end $$;

-- ───────────────────────── notifications ─────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  kind text not null check (kind in ('comment', 'reply', 'mention', 'answer')),
  actor_id uuid references public.profiles (id) on delete set null,
  post_id uuid,
  comment_id uuid,
  preview text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.notify(p_user uuid, p_community uuid, p_kind text, p_actor uuid, p_post uuid, p_comment uuid, p_preview text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n public.notifications;
begin
  if p_user is null or p_user = p_actor then return; end if;
  if not exists (select 1 from public.community_members where community_id = p_community and user_id = p_user) then return; end if;
  insert into public.notifications (user_id, community_id, kind, actor_id, post_id, comment_id, preview)
  values (p_user, p_community, p_kind, p_actor, p_post, p_comment, substr(coalesce(p_preview, ''), 1, 140))
  returning * into n;
  perform public.emit('user:' || p_user, 'notify', to_jsonb(n) || jsonb_build_object(
    'actor', (select display_name from public.profiles where id = p_actor)));
end $$;

-- Notify everyone @mentioned in a text (members of the community only).
create or replace function public.notify_mentions(p_body text, p_community uuid, p_actor uuid, p_post uuid, p_comment uuid, p_skip uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  for target in
    select distinct p.id
    from regexp_matches(coalesce(p_body, ''), '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})', 'g') as m
    join public.profiles p on p.username = lower(m[1])
    join public.community_members cm on cm.user_id = p.id and cm.community_id = p_community
  loop
    if not (target = any (coalesce(p_skip, '{}'))) then
      perform public.notify(target, p_community, 'mention', p_actor, p_post, p_comment, p_body);
    end if;
  end loop;
end $$;

-- ───────────────────────── feed ─────────────────────────

create table public.post_categories (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  emoji text not null default '' check (char_length(emoji) <= 8),
  position int not null default 0,
  post_min_role text not null default 'member' check (post_min_role in ('member', 'mod', 'admin', 'owner')),
  -- Questions-style categories let the asker mark the most helpful comment as the answer.
  answers boolean not null default false,
  unique (community_id, name)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  category_id uuid references public.post_categories (id) on delete set null,
  author_id uuid not null references public.profiles (id),
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  like_count int not null default 0,
  comment_count int not null default 0,
  answer_comment_id uuid,
  last_activity_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))) stored,
  constraint posts_title_len check (deleted_at is not null or char_length(title) between 1 and 200),
  constraint posts_body_len check (char_length(body) <= 20000)
);
create index posts_feed_idx on public.posts (community_id, pinned desc, last_activity_at desc) where deleted_at is null;
create index posts_new_idx on public.posts (community_id, created_at desc) where deleted_at is null;
create index posts_top_idx on public.posts (community_id, like_count desc) where deleted_at is null;
create index posts_category_idx on public.posts (category_id, last_activity_at desc);
create index posts_search_idx on public.posts using gin (search);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  parent_id uuid references public.post_comments (id) on delete cascade,
  body text not null,
  like_count int not null default 0,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint comments_body_len check (deleted_at is not null or char_length(body) between 1 and 8000)
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);
alter table public.posts add constraint posts_answer_fk foreign key (answer_comment_id) references public.post_comments (id) on delete set null;

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comment_likes (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create or replace function public.posts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cat public.post_categories;
begin
  if new.category_id is not null then
    select * into cat from public.post_categories where id = new.category_id;
    if not found or cat.community_id <> new.community_id then raise exception 'category not found'; end if;
    if public.role_rank(public.my_role(new.community_id)) < public.role_rank(cat.post_min_role) then
      raise exception 'only % and up can post in %', cat.post_min_role, cat.name;
    end if;
  end if;
  new.title := trim(new.title);
  new.pinned := false;
  new.like_count := 0;
  new.comment_count := 0;
  new.answer_comment_id := null;
  new.edited_at := null;
  new.deleted_at := null;
  new.created_at := now();
  new.last_activity_at := now();
  return new;
end $$;

create trigger posts_before_insert before insert on public.posts
  for each row execute function public.posts_before_insert();

create or replace function public.posts_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cat public.post_categories;
begin
  if (new.title is distinct from old.title or new.body is distinct from old.body) and new.deleted_at is null then
    new.edited_at := now();
  end if;
  if new.category_id is distinct from old.category_id and new.category_id is not null then
    select * into cat from public.post_categories where id = new.category_id;
    if not found or cat.community_id <> new.community_id then raise exception 'category not found'; end if;
  end if;
  return new;
end $$;

create trigger posts_before_update before update on public.posts
  for each row execute function public.posts_before_update();

create or replace function public.posts_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_mentions(new.title || ' ' || new.body, new.community_id, new.author_id, new.id, null, null);
  perform public.emit('community:' || new.community_id, 'post',
    jsonb_build_object('id', new.id, 'author_id', new.author_id, 'category_id', new.category_id));
  return new;
end $$;

create trigger posts_after_insert after insert on public.posts
  for each row execute function public.posts_after_insert();

create or replace function public.posts_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit('post:' || new.id, 'post_update', to_jsonb(new) - 'search');
  return new;
end $$;

create trigger posts_after_update after update on public.posts
  for each row execute function public.posts_after_update();

create or replace function public.comments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
  parent public.post_comments;
begin
  select * into p from public.posts where id = new.post_id;
  if not found or p.deleted_at is not null then raise exception 'post not found'; end if;
  new.community_id := p.community_id;
  if new.parent_id is not null then
    select * into parent from public.post_comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id then raise exception 'reply must be on the same post'; end if;
    -- Replies to replies attach to the top-level comment (one level of nesting).
    if parent.parent_id is not null then new.parent_id := parent.parent_id; end if;
  end if;
  new.like_count := 0;
  new.edited_at := null;
  new.deleted_at := null;
  new.created_at := now();
  return new;
end $$;

create trigger comments_before_insert before insert on public.post_comments
  for each row execute function public.comments_before_insert();

create or replace function public.comments_before_update() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body and new.deleted_at is null then new.edited_at := now(); end if;
  return new;
end $$;

create trigger comments_before_update before update on public.post_comments
  for each row execute function public.comments_before_update();

create or replace function public.comments_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
  parent_author uuid;
begin
  update public.posts set comment_count = comment_count + 1, last_activity_at = now()
    where id = new.post_id returning * into p;
  if new.parent_id is not null then
    select author_id into parent_author from public.post_comments where id = new.parent_id;
    perform public.notify(parent_author, new.community_id, 'reply', new.author_id, new.post_id, new.id, new.body);
  end if;
  if parent_author is distinct from p.author_id then
    perform public.notify(p.author_id, new.community_id, 'comment', new.author_id, new.post_id, new.id, new.body);
  end if;
  perform public.notify_mentions(new.body, new.community_id, new.author_id, new.post_id, new.id,
    array[p.author_id, parent_author]);
  perform public.emit('post:' || new.post_id, 'comment', to_jsonb(new));
  return new;
end $$;

create trigger comments_after_insert after insert on public.post_comments
  for each row execute function public.comments_after_insert();

create or replace function public.comments_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit('post:' || new.post_id, 'comment_update', to_jsonb(new));
  return new;
end $$;

create trigger comments_after_update after update on public.post_comments
  for each row execute function public.comments_after_update();

create or replace function public.post_likes_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id returning * into p;
    perform public.award(p.community_id, p.author_id, 1, 'like', new.user_id, p.id);
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

create trigger post_likes_change after insert or delete on public.post_likes
  for each row execute function public.post_likes_change();

create or replace function public.comment_likes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select post_id into new.post_id from public.post_comments where id = new.comment_id;
  if new.post_id is null then raise exception 'comment not found'; end if;
  return new;
end $$;

create trigger comment_likes_before_insert before insert on public.comment_likes
  for each row execute function public.comment_likes_before_insert();

create or replace function public.comment_likes_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.post_comments;
begin
  if tg_op = 'INSERT' then
    update public.post_comments set like_count = like_count + 1 where id = new.comment_id returning * into c;
    perform public.award(c.community_id, c.author_id, 1, 'like', new.user_id, c.id);
  else
    update public.post_comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end $$;

create trigger comment_likes_change after insert or delete on public.comment_likes
  for each row execute function public.comment_likes_change();

-- ───────────────────────── classroom ─────────────────────────

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  emoji text not null default '' check (char_length(emoji) <= 8),
  position int not null default 0,
  unlock_level int not null default 1 check (unlock_level between 1 and 9),
  published boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index courses_community_idx on public.courses (community_id, position);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  position int not null default 0
);
create index course_modules_course_idx on public.course_modules (course_id, position);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  module_id uuid not null references public.course_modules (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  position int not null default 0,
  -- Drip: the lesson opens this many days after the member joined.
  drip_days int not null default 0 check (drip_days between 0 and 3650),
  created_at timestamptz not null default now()
);
create index lessons_course_idx on public.lessons (course_id, position);

-- Lesson content lives apart from lesson titles so locked lessons can still be listed.
create table public.lesson_content (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 50000),
  video_url text check (video_url is null or video_url ~ '^https://')
);

create table public.lesson_progress (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (lesson_id, user_id)
);
create index lesson_progress_user_idx on public.lesson_progress (user_id, course_id);

create or replace function public.set_community_from_course() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select community_id into new.community_id from public.courses where id = new.course_id;
  if new.community_id is null then raise exception 'course not found'; end if;
  if tg_table_name = 'lessons' then
    if not exists (select 1 from public.course_modules where id = (to_jsonb(new) ->> 'module_id')::uuid and course_id = new.course_id) then
      raise exception 'module is not part of this course';
    end if;
  end if;
  return new;
end $$;

create trigger course_modules_set_community before insert or update on public.course_modules
  for each row execute function public.set_community_from_course();
create trigger lessons_set_community before insert or update on public.lessons
  for each row execute function public.set_community_from_course();

create or replace function public.can_access_course(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses c
    join public.community_members cm on cm.community_id = c.community_id and cm.user_id = (select auth.uid())
    where c.id = p_course
      and (public.role_rank(cm.role) >= 3 or (c.published and public.level_for(cm.points) >= c.unlock_level))
  )
$$;

create or replace function public.can_access_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lessons l
    join public.courses c on c.id = l.course_id
    join public.community_members cm on cm.community_id = c.community_id and cm.user_id = (select auth.uid())
    where l.id = p_lesson
      and (public.role_rank(cm.role) >= 3
           or (c.published and public.level_for(cm.points) >= c.unlock_level
               and cm.joined_at + make_interval(days => l.drip_days) <= now()))
  )
$$;

create or replace function public.complete_lesson(p_lesson uuid, p_done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.lessons;
  uid uuid := (select auth.uid());
begin
  if not public.can_access_lesson(p_lesson) then raise exception 'lesson is locked'; end if;
  select * into l from public.lessons where id = p_lesson;
  if p_done then
    insert into public.lesson_progress (lesson_id, user_id, course_id) values (l.id, uid, l.course_id) on conflict do nothing;
    -- One point per lesson, once, ever (re-completing pays nothing).
    insert into public.points_ledger (community_id, user_id, amount, reason, source_id)
    values (l.community_id, uid, 1, 'lesson', l.id) on conflict do nothing;
  else
    delete from public.lesson_progress where lesson_id = l.id and user_id = uid;
  end if;
end $$;

-- Course cards for the classroom page: progress and lock state for the caller.
create or replace function public.course_overview(p_community uuid)
returns table (id uuid, title text, description text, emoji text, published boolean, unlock_level int,
               lesson_count int, done_count int, locked boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.description, c.emoji, c.published, c.unlock_level,
    (select count(*)::int from public.lessons l where l.course_id = c.id),
    (select count(*)::int from public.lesson_progress lp where lp.course_id = c.id and lp.user_id = (select auth.uid())),
    not public.can_access_course(c.id)
  from public.courses c
  where c.community_id = p_community and public.is_member(p_community)
    and (c.published or public.has_role(p_community, 'admin'))
  order by c.position, c.created_at
$$;

-- Lesson list for one course, with lock reasons the UI can show.
create or replace function public.course_lessons(p_course uuid)
returns table (id uuid, module_id uuid, title text, "position" int, drip_days int, done boolean, locked boolean, opens_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.module_id, l.title, l.position, l.drip_days,
    exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id and lp.user_id = (select auth.uid())),
    not public.can_access_lesson(l.id),
    cm.joined_at + make_interval(days => l.drip_days)
  from public.lessons l
  join public.courses c on c.id = l.course_id
  join public.community_members cm on cm.community_id = c.community_id and cm.user_id = (select auth.uid())
  where l.course_id = p_course and (c.published or public.role_rank(cm.role) >= 3)
  order by l.position, l.created_at
$$;

-- ───────────────────────── calendar ─────────────────────────

create table public.events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  description text not null default '' check (char_length(description) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  room_id uuid references public.rooms (id) on delete set null,
  location_url text check (location_url is null or location_url ~ '^https?://'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint events_time check (ends_at > starts_at and ends_at - starts_at <= interval '7 days')
);
create index events_community_idx on public.events (community_id, starts_at);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function public.events_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms where id = new.room_id and community_id = new.community_id) then
    raise exception 'room must be in this community';
  end if;
  return new;
end $$;

create trigger events_before_write before insert or update on public.events
  for each row execute function public.events_before_write();

create or replace function public.events_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.events := coalesce(new, old);
begin
  perform public.emit('community:' || e.community_id, 'event', jsonb_build_object('op', lower(tg_op), 'event', to_jsonb(e)));
  return null;
end $$;

create trigger events_after_change after insert or update or delete on public.events
  for each row execute function public.events_broadcast();

-- ───────────────────────── row-level security ─────────────────────────

alter table public.points_ledger enable row level security;
alter table public.notifications enable row level security;
alter table public.post_categories enable row level security;
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.comment_likes enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_content enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

create policy points_select on public.points_ledger for select to authenticated
  using (public.is_member(community_id));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy categories_select on public.post_categories for select to authenticated
  using (public.is_member(community_id));
create policy categories_write on public.post_categories for all to authenticated
  using (public.has_role(community_id, 'admin')) with check (public.has_role(community_id, 'admin'));

create policy posts_select on public.posts for select to authenticated
  using (public.is_member(community_id));
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_member(community_id));
create policy posts_update on public.posts for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null) with check (author_id = (select auth.uid()));

create policy comments_select on public.post_comments for select to authenticated
  using (public.is_member(community_id));
create policy comments_insert on public.post_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.community_id))
  );
create policy comments_update on public.post_comments for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null) with check (author_id = (select auth.uid()));

create policy post_likes_select on public.post_likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.community_id)));
create policy post_likes_insert on public.post_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.community_id)
                and p.deleted_at is null and p.author_id <> (select auth.uid()))
  );
create policy post_likes_delete on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy comment_likes_select on public.comment_likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.community_id)));
create policy comment_likes_insert on public.comment_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.post_comments c where c.id = comment_id and public.is_member(c.community_id)
                and c.deleted_at is null and c.author_id <> (select auth.uid()))
  );
create policy comment_likes_delete on public.comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy courses_select on public.courses for select to authenticated
  using (public.is_member(community_id) and (published or public.has_role(community_id, 'admin')));
create policy courses_insert on public.courses for insert to authenticated
  with check (public.has_role(community_id, 'admin') and created_by = (select auth.uid()));
create policy courses_update on public.courses for update to authenticated
  using (public.has_role(community_id, 'admin')) with check (public.has_role(community_id, 'admin'));
create policy courses_delete on public.courses for delete to authenticated
  using (public.has_role(community_id, 'admin'));

create policy modules_select on public.course_modules for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id));
create policy modules_write on public.course_modules for all to authenticated
  using (public.has_role(community_id, 'admin'))
  with check (exists (select 1 from public.courses c where c.id = course_id and public.has_role(c.community_id, 'admin')));

create policy lessons_select on public.lessons for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id));
create policy lessons_write on public.lessons for all to authenticated
  using (public.has_role(community_id, 'admin'))
  with check (exists (select 1 from public.courses c where c.id = course_id and public.has_role(c.community_id, 'admin')));

create policy lesson_content_select on public.lesson_content for select to authenticated
  using (public.can_access_lesson(lesson_id));
create policy lesson_content_write on public.lesson_content for all to authenticated
  using (exists (select 1 from public.lessons l where l.id = lesson_id and public.has_role(l.community_id, 'admin')))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and public.has_role(l.community_id, 'admin')));

create policy lesson_progress_select on public.lesson_progress for select to authenticated
  using (user_id = (select auth.uid()));

create policy events_select on public.events for select to authenticated
  using (public.is_member(community_id));
create policy events_insert on public.events for insert to authenticated
  with check (public.has_role(community_id, 'mod') and created_by = (select auth.uid()));
create policy events_update on public.events for update to authenticated
  using (public.has_role(community_id, 'mod')) with check (public.has_role(community_id, 'mod'));
create policy events_delete on public.events for delete to authenticated
  using (public.has_role(community_id, 'mod'));

create policy rsvps_select on public.event_rsvps for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));
create policy rsvps_write on public.event_rsvps for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.events e where e.id = event_id and public.is_member(e.community_id)));

-- Column-level write limits.
revoke update on public.posts from anon, authenticated;
grant update (title, body, category_id) on public.posts to authenticated;
revoke update on public.post_comments from anon, authenticated;
grant update (body) on public.post_comments to authenticated;
revoke update on public.community_members from anon, authenticated;
revoke insert, update, delete on public.points_ledger from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
revoke insert, update, delete on public.lesson_progress from anon, authenticated;
revoke update on public.events from anon, authenticated;
grant update (title, description, starts_at, ends_at, room_id, location_url) on public.events to authenticated;
revoke update on public.courses from anon, authenticated;
grant update (title, description, emoji, position, unlock_level, published) on public.courses to authenticated;

-- ───────────────────────── RPCs ─────────────────────────

create or replace function public.delete_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = p_post;
  if not found or p.deleted_at is not null then return; end if;
  if p.author_id <> (select auth.uid()) and (
       public.role_rank(public.my_role(p.community_id)) < 2
       or public.role_rank(public.my_role(p.community_id)) <= public.role_rank(
            (select role from public.community_members where community_id = p.community_id and user_id = p.author_id))) then
    raise exception 'not allowed';
  end if;
  update public.posts set deleted_at = now(), title = '', body = '', pinned = false where id = p_post;
end $$;

create or replace function public.delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.post_comments;
begin
  select * into c from public.post_comments where id = p_comment;
  if not found or c.deleted_at is not null then return; end if;
  if c.author_id <> (select auth.uid()) and (
       public.role_rank(public.my_role(c.community_id)) < 2
       or public.role_rank(public.my_role(c.community_id)) <= public.role_rank(
            (select role from public.community_members where community_id = c.community_id and user_id = c.author_id))) then
    raise exception 'not allowed';
  end if;
  update public.post_comments set deleted_at = now(), body = '' where id = p_comment;
  update public.posts set comment_count = greatest(comment_count - 1, 0),
    answer_comment_id = case when answer_comment_id = p_comment then null else answer_comment_id end
    where id = c.post_id;
end $$;

create or replace function public.pin_post(p_post uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = p_post;
  if not found or not public.has_role(p.community_id, 'mod') then raise exception 'not allowed'; end if;
  update public.posts set pinned = p_pinned where id = p_post and deleted_at is null;
end $$;

-- The asker (or a mod) marks the most helpful comment. The commenter gets 5 points, once.
create or replace function public.mark_answer(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.post_comments;
  p public.posts;
begin
  select * into c from public.post_comments where id = p_comment;
  if not found or c.deleted_at is not null then raise exception 'comment not found'; end if;
  select * into p from public.posts where id = c.post_id;
  if p.author_id <> (select auth.uid()) and not public.has_role(p.community_id, 'mod') then raise exception 'not allowed'; end if;
  if not coalesce((select answers from public.post_categories where id = p.category_id), false) then
    raise exception 'answers are only for question categories';
  end if;
  update public.posts set answer_comment_id = c.id where id = p.id;
  if c.author_id <> p.author_id then
    perform public.award(p.community_id, c.author_id, 5, 'answer', p.author_id, c.id);
    perform public.notify(c.author_id, p.community_id, 'answer', (select auth.uid()), p.id, c.id, p.title);
  end if;
end $$;

create or replace function public.unmark_answer(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = p_post;
  if not found then return; end if;
  if p.author_id <> (select auth.uid()) and not public.has_role(p.community_id, 'mod') then raise exception 'not allowed'; end if;
  update public.posts set answer_comment_id = null where id = p_post;
end $$;

create or replace function public.mark_notifications_read(p_community uuid) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and community_id = p_community and read_at is null
$$;

-- Leaderboard. 'all' ranks by lifetime points; '7d' / '30d' rank by points earned in that window,
-- so a new member can top this week's board.
create or replace function public.leaderboard(p_community uuid, p_period text default '7d', p_limit int default 50)
returns table (user_id uuid, points int, total_points int, level int)
language sql stable security definer set search_path = public as $$
  select cm.user_id,
    case when p_period = 'all' then cm.points else coalesce(w.pts, 0) end,
    cm.points,
    public.level_for(cm.points)
  from public.community_members cm
  left join (
    select l.user_id, sum(l.amount)::int pts from public.points_ledger l
    where l.community_id = p_community
      and l.created_at > now() - case p_period when '30d' then interval '30 days' else interval '7 days' end
    group by l.user_id
  ) w on w.user_id = cm.user_id and p_period <> 'all'
  where cm.community_id = p_community and public.is_member(p_community)
    and (case when p_period = 'all' then cm.points else coalesce(w.pts, 0) end) > 0
  order by 2 desc, cm.joined_at
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

create or replace function public.my_standing(p_community uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'points', cm.points,
    'level', public.level_for(cm.points),
    'level_floor', public.level_floor(public.level_for(cm.points)),
    'next_level_at', case when public.level_for(cm.points) < 9 then public.level_floor(public.level_for(cm.points) + 1) end,
    'week_points', (select coalesce(sum(amount), 0) from public.points_ledger l
                    where l.community_id = p_community and l.user_id = cm.user_id and l.created_at > now() - interval '7 days'),
    'levels', (select jsonb_agg(jsonb_build_object('level', lv, 'members', (
                 select count(*) from public.community_members x where x.community_id = p_community and public.level_for(x.points) = lv))
               order by lv) from generate_series(1, 9) lv)
  )
  from public.community_members cm
  where cm.community_id = p_community and cm.user_id = (select auth.uid())
$$;

create or replace function public.search_posts(p_community uuid, p_query text, p_limit int default 30)
returns setof public.posts
language sql stable security definer set search_path = public as $$
  select * from public.posts p
  where public.is_member(p_community) and p.community_id = p_community and p.deleted_at is null
    and p.search @@ websearch_to_tsquery('simple', p_query)
  order by p.last_activity_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- New communities start with feed categories (and existing ones get them now).
create or replace function public.seed_categories(c uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.post_categories (community_id, name, emoji, position, post_min_role, answers) values
    (c, 'General', '💬', 0, 'member', false),
    (c, 'Questions', '❓', 1, 'member', true),
    (c, 'Wins', '🏆', 2, 'member', false),
    (c, 'Announcements', '📣', 3, 'mod', false)
  on conflict (community_id, name) do nothing
$$;

do $$ begin perform public.seed_categories(id) from public.communities; end $$;

create or replace function public.create_community(p_name text, p_slug text, p_description text default '', p_icon text default '')
returns public.communities
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  c public.communities;
begin
  if uid is null then raise exception 'sign in first'; end if;
  insert into public.communities (slug, name, description, icon, owner_id)
  values (lower(p_slug), trim(p_name), coalesce(p_description, ''), coalesce(p_icon, ''), uid)
  returning * into c;
  insert into public.community_members (community_id, user_id, role) values (c.id, uid, 'owner');
  insert into public.rooms (community_id, slug, name, topic, kind, post_min_role, position) values
    (c.id, 'announcements', 'announcements', 'News from the crew. Only mods post here.', 'text', 'mod', 0),
    (c.id, 'general', 'general', 'Say hi.', 'text', 'member', 1),
    (c.id, 'lounge', 'lounge', 'Drop in to talk or share your screen.', 'voice', 'member', 2);
  perform public.seed_categories(c.id);
  return c;
end $$;

-- Realtime: add per-post topics (comments and edits on one post).
create or replace function public.can_use_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_topic is null then return false; end if;
  if p_topic ~ '^room:[0-9a-f-]{36}$' then
    return exists (select 1 from public.rooms r where r.id = substr(p_topic, 6)::uuid and public.is_member(r.community_id));
  elsif p_topic ~ '^post:[0-9a-f-]{36}$' then
    return exists (select 1 from public.posts p where p.id = substr(p_topic, 6)::uuid and public.is_member(p.community_id));
  elsif p_topic ~ '^community:[0-9a-f-]{36}$' then
    return public.is_member(substr(p_topic, 11)::uuid);
  elsif p_topic ~ '^user:[0-9a-f-]{36}$' then
    return substr(p_topic, 6)::uuid = uid;
  end if;
  return false;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.emit(text, text, jsonb) from authenticated;
revoke execute on function public.award(uuid, uuid, int, text, uuid, uuid) from authenticated;
revoke execute on function public.notify(uuid, uuid, text, uuid, uuid, uuid, text) from authenticated;
revoke execute on function public.notify_mentions(text, uuid, uuid, uuid, uuid, uuid[]) from authenticated;
revoke execute on function public.seed_categories(uuid) from authenticated;
