-- Ctrl Room — initial schema.
--
-- Communities → rooms → messages (threads are messages with a parent_id).
-- Every table has row-level security; the browser talks to Postgres directly with the
-- user's JWT, so these policies ARE the permission system. Anything that needs to touch
-- rows the caller can't write directly (joining, moderation, counters) is a
-- SECURITY DEFINER function that checks the caller's role itself.
--
-- Live updates use Supabase Realtime *broadcast from the database* (realtime.send) on
-- private topics, not postgres_changes: one message fans out to subscribers of its room
-- topic only, which is what lets this scale past a handful of busy rooms.
--   room:<room_id>           new/edited/deleted messages, reactions, board changes, typing
--   community:<community_id> room list changes + "something new in room X" pings
--   user:<user_id>           mentions and replies for this user

-- ───────────────────────── helpers ─────────────────────────

create or replace function public.role_rank(r text) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'mod' then 2 when 'member' then 1 else 0 end
$$;

-- ───────────────────────── tables ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{2,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(name) between 2 and 64),
  description text not null default '' check (char_length(description) <= 280),
  icon text not null default '' check (char_length(icon) <= 8),
  is_public boolean not null default false,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'mod', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

create table public.bans (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null default '',
  banned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$'),
  name text not null check (char_length(name) between 1 and 48),
  topic text not null default '' check (char_length(topic) <= 280),
  kind text not null default 'text' check (kind in ('text', 'voice')),
  -- Announcement-style rooms: everyone reads, only mods and up post.
  post_min_role text not null default 'member' check (post_min_role in ('member', 'mod', 'admin', 'owner')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (community_id, slug)
);
create index rooms_community_idx on public.rooms (community_id, position);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  parent_id uuid references public.messages (id) on delete cascade,
  body text not null,
  reply_count int not null default 0,
  last_reply_at timestamptz,
  -- A thread can be closed with an outcome; the outcome shows under the message in the room.
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  outcome text check (outcome is null or char_length(outcome) between 1 and 500),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored,
  constraint messages_body_len check (deleted_at is not null or char_length(body) between 1 and 4000)
);
create index messages_room_roots_idx on public.messages (room_id, created_at desc) where parent_id is null;
create index messages_thread_idx on public.messages (parent_id, created_at) where parent_id is not null;
create index messages_room_created_idx on public.messages (room_id, created_at);
create index messages_search_idx on public.messages using gin (search);

create table public.reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- The room "board": what should still be findable next month. Decisions, links, docs.
create table public.board_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  kind text not null default 'note' check (kind in ('decision', 'link', 'doc', 'note')),
  title text not null check (char_length(title) between 1 and 140),
  url text check (url is null or url ~ '^https?://'),
  body text not null default '' check (char_length(body) <= 2000),
  message_id uuid references public.messages (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index board_items_room_idx on public.board_items (room_id, created_at desc);

-- Per-user, per-room state. Quiet by default: 'mentions' means only @you and replies to you ping.
create table public.room_state (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  notify text not null default 'mentions' check (notify in ('all', 'mentions', 'none')),
  primary key (room_id, user_id)
);

create table public.mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  kind text not null default 'mention' check (kind in ('mention', 'reply')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index mentions_user_idx on public.mentions (user_id, room_id, created_at desc);

create table public.invites (
  code text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  community_id uuid not null references public.communities (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_community_idx on public.invites (community_id);

-- ───────────────────────── membership helpers ─────────────────────────

create or replace function public.my_role(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.community_members where community_id = c and user_id = (select auth.uid())
$$;

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = c and user_id = (select auth.uid()))
$$;

create or replace function public.has_role(c uuid, min_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_rank(public.my_role(c)) >= public.role_rank(min_role)
$$;

create or replace function public.shares_community(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.community_members a
    join public.community_members b on b.community_id = a.community_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  )
$$;

-- Wraps realtime.send so every broadcast goes through one place.
create or replace function public.emit(topic text, event text, payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(payload, event, topic, true);
end $$;

-- ───────────────────────── profiles ─────────────────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'));
  base := substr(base, 1, 24);
  if char_length(base) < 2 then base := 'user'; end if;
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := base || floor(random() * 9000 + 1000)::int::text;
    exit when n > 20;
  end loop;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    substr(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), candidate), 1, 64)
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── message triggers ─────────────────────────

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  p public.messages;
begin
  select * into r from public.rooms where id = new.room_id;
  if not found then raise exception 'room not found'; end if;
  -- Never trust a client-supplied community or counters.
  new.community_id := r.community_id;
  new.reply_count := 0;
  new.last_reply_at := null;
  new.resolved_at := null;
  new.resolved_by := null;
  new.outcome := null;
  new.edited_at := null;
  new.deleted_at := null;
  new.created_at := now();

  if new.parent_id is not null then
    select * into p from public.messages where id = new.parent_id;
    if not found or p.room_id <> new.room_id then raise exception 'thread parent must be in the same room'; end if;
    if p.parent_id is not null then raise exception 'threads are one level deep'; end if;
    if p.deleted_at is not null then raise exception 'cannot reply to a deleted message'; end if;
  elsif public.role_rank(public.my_role(r.community_id)) < public.role_rank(r.post_min_role) then
    -- Replies in announcement rooms stay open to everyone; new top-level posts don't.
    raise exception 'only % and up can post in this room', r.post_min_role;
  end if;
  return new;
end $$;

create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.messages_before_update() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger messages_before_update before update on public.messages
  for each row execute function public.messages_before_update();

create or replace function public.message_payload(m public.messages) returns jsonb
language sql stable as $$
  select to_jsonb(m) - 'search'
$$;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_author uuid;
  handle text;
  target uuid;
begin
  if new.parent_id is not null then
    update public.messages
      set reply_count = reply_count + 1, last_reply_at = new.created_at
      where id = new.parent_id
      returning author_id into parent_author;
    if parent_author is not null and parent_author <> new.author_id then
      insert into public.mentions (message_id, user_id, room_id, kind)
      values (new.id, parent_author, new.room_id, 'reply')
      on conflict do nothing;
    end if;
  end if;

  -- @username mentions, only for people who are in this community.
  for handle in
    select distinct lower(m[1]) from regexp_matches(new.body, '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})', 'g') as m
  loop
    select p.id into target
      from public.profiles p
      join public.community_members cm on cm.user_id = p.id and cm.community_id = new.community_id
      where p.username = handle;
    if target is not null and target <> new.author_id then
      insert into public.mentions (message_id, user_id, room_id, kind)
      values (new.id, target, new.room_id, 'mention')
      on conflict (message_id, user_id) do update set kind = 'mention';
    end if;
    target := null;
  end loop;

  perform public.emit('room:' || new.room_id, 'message', public.message_payload(new));
  perform public.emit('community:' || new.community_id, 'activity',
    jsonb_build_object('room_id', new.room_id, 'message_id', new.id, 'author_id', new.author_id,
                       'thread', new.parent_id is not null, 'at', new.created_at));
  return new;
end $$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.messages_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit('room:' || new.room_id, 'message_update', public.message_payload(new));
  return new;
end $$;

create trigger messages_after_update after update on public.messages
  for each row execute function public.messages_after_update();

create or replace function public.mentions_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  author public.profiles;
begin
  select * into m from public.messages where id = new.message_id;
  select * into author from public.profiles where id = m.author_id;
  perform public.emit('user:' || new.user_id, 'mention', jsonb_build_object(
    'kind', new.kind,
    'message_id', m.id,
    'room_id', m.room_id,
    'community_id', m.community_id,
    'parent_id', m.parent_id,
    'author', author.display_name,
    'preview', substr(m.body, 1, 140)
  ));
  return new;
end $$;

create trigger mentions_after_insert after insert on public.mentions
  for each row execute function public.mentions_after_insert();

-- ───────────────────────── reactions / board / rooms triggers ─────────────────────────

create or replace function public.reactions_set_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select room_id into new.room_id from public.messages where id = new.message_id;
  if new.room_id is null then raise exception 'message not found'; end if;
  return new;
end $$;

create trigger reactions_before_insert before insert on public.reactions
  for each row execute function public.reactions_set_room();

create or replace function public.reactions_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.reactions := coalesce(new, old);
begin
  perform public.emit('room:' || r.room_id, case when tg_op = 'DELETE' then 'reaction_remove' else 'reaction_add' end,
    jsonb_build_object('message_id', r.message_id, 'user_id', r.user_id, 'emoji', r.emoji));
  return null;
end $$;

create trigger reactions_after_change after insert or delete on public.reactions
  for each row execute function public.reactions_broadcast();

create or replace function public.board_items_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select community_id into new.community_id from public.rooms where id = new.room_id;
  if new.community_id is null then raise exception 'room not found'; end if;
  new.created_at := now();
  return new;
end $$;

create trigger board_items_before_insert before insert on public.board_items
  for each row execute function public.board_items_before_insert();

create or replace function public.board_items_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b public.board_items := coalesce(new, old);
begin
  perform public.emit('room:' || b.room_id, 'board', jsonb_build_object('op', lower(tg_op), 'item', to_jsonb(b)));
  return null;
end $$;

create trigger board_items_after_change after insert or update or delete on public.board_items
  for each row execute function public.board_items_broadcast();

create or replace function public.rooms_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms := coalesce(new, old);
begin
  perform public.emit('community:' || r.community_id, 'rooms', jsonb_build_object('op', lower(tg_op), 'room', to_jsonb(r)));
  return null;
end $$;

create trigger rooms_after_change after insert or update or delete on public.rooms
  for each row execute function public.rooms_broadcast();

-- ───────────────────────── row-level security ─────────────────────────

alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.bans enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.board_items enable row level security;
alter table public.room_state enable row level security;
alter table public.mentions enable row level security;
alter table public.invites enable row level security;

-- Profiles: you see yourself and people you share a community with.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_community(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy communities_select on public.communities for select to authenticated
  using (is_public or public.is_member(id));
create policy communities_update on public.communities for update to authenticated
  using (public.has_role(id, 'admin')) with check (public.has_role(id, 'admin'));

create policy members_select on public.community_members for select to authenticated
  using (public.is_member(community_id));

create policy bans_select on public.bans for select to authenticated
  using (public.has_role(community_id, 'mod'));

create policy rooms_select on public.rooms for select to authenticated
  using (public.is_member(community_id));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (public.has_role(community_id, 'admin'));
create policy rooms_update on public.rooms for update to authenticated
  using (public.has_role(community_id, 'admin')) with check (public.has_role(community_id, 'admin'));
create policy rooms_delete on public.rooms for delete to authenticated
  using (public.has_role(community_id, 'admin'));

create policy messages_select on public.messages for select to authenticated
  using (public.is_member(community_id));
-- community_id is overwritten from the room by the trigger, so check membership via the room.
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );
create policy messages_update on public.messages for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null)
  with check (author_id = (select auth.uid()));

create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id)));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.community_id) and m.deleted_at is null)
  );
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy board_select on public.board_items for select to authenticated
  using (public.is_member(community_id));
create policy board_insert on public.board_items for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );
create policy board_update on public.board_items for update to authenticated
  using (created_by = (select auth.uid()) or public.has_role(community_id, 'mod'))
  with check (created_by = (select auth.uid()) or public.has_role(community_id, 'mod'));
create policy board_delete on public.board_items for delete to authenticated
  using (created_by = (select auth.uid()) or public.has_role(community_id, 'mod'));

create policy room_state_all on public.room_state for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );

create policy mentions_select on public.mentions for select to authenticated
  using (user_id = (select auth.uid()));

create policy invites_select on public.invites for select to authenticated
  using (public.has_role(community_id, 'mod'));
create policy invites_insert on public.invites for insert to authenticated
  with check (created_by = (select auth.uid()) and public.has_role(community_id, 'mod'));
create policy invites_delete on public.invites for delete to authenticated
  using (public.has_role(community_id, 'mod'));

-- Column-level limits on top of RLS: a user can edit the text of their own message,
-- nothing else (counters, outcomes and soft-deletes go through functions below).
revoke update on public.messages from anon, authenticated;
grant update (body) on public.messages to authenticated;
revoke update on public.communities from anon, authenticated;
grant update (name, description, icon, is_public) on public.communities to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
revoke update on public.board_items from anon, authenticated;
grant update (kind, title, url, body) on public.board_items to authenticated;
revoke update on public.room_state from anon, authenticated;
grant update (last_read_at, notify) on public.room_state to authenticated;
revoke update on public.rooms from anon, authenticated;
grant update (name, topic, kind, post_min_role, position) on public.rooms to authenticated;

-- Realtime private topics: who may listen / send typing pings.
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
  end if;
  return false;
end $$;

create policy ctrlroom_receive on realtime.messages for select to authenticated
  using (public.can_use_topic(realtime.topic()));
-- Clients may only send ephemeral events (typing, presence) into room topics.
create policy ctrlroom_send on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'room:%' and public.can_use_topic(realtime.topic()));

-- ───────────────────────── RPCs ─────────────────────────

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
  return c;
end $$;

create or replace function public.join_with_invite(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  inv public.invites;
  c_slug text;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found then raise exception 'invite not found'; end if;
  select slug into c_slug from public.communities where id = inv.community_id;
  if exists (select 1 from public.community_members where community_id = inv.community_id and user_id = uid) then
    return c_slug;
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'invite expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'invite used up'; end if;
  if exists (select 1 from public.bans where community_id = inv.community_id and user_id = uid) then
    raise exception 'you cannot join this community';
  end if;
  insert into public.community_members (community_id, user_id) values (inv.community_id, uid);
  update public.invites set uses = uses + 1 where code = inv.code;
  return c_slug;
end $$;

create or replace function public.join_public(p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  c public.communities;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into c from public.communities where slug = lower(p_slug) and is_public;
  if not found then raise exception 'community not found'; end if;
  if exists (select 1 from public.bans where community_id = c.id and user_id = uid) then
    raise exception 'you cannot join this community';
  end if;
  insert into public.community_members (community_id, user_id) values (c.id, uid) on conflict do nothing;
  return c.slug;
end $$;

create or replace function public.leave_community(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_community) = 'owner' then raise exception 'owners hand the community to someone else before leaving'; end if;
  delete from public.community_members where community_id = p_community and user_id = (select auth.uid());
end $$;

create or replace function public.set_member_role(p_community uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := public.role_rank(public.my_role(p_community));
  theirs int;
begin
  if p_role not in ('admin', 'mod', 'member') then raise exception 'role must be admin, mod or member'; end if;
  select public.role_rank(role) into theirs from public.community_members where community_id = p_community and user_id = p_user;
  if theirs is null then raise exception 'not a member'; end if;
  -- Admins manage mods and members; only the owner can make or unmake admins.
  if mine < 3 or theirs >= mine or public.role_rank(p_role) >= mine then raise exception 'not allowed'; end if;
  update public.community_members set role = p_role where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.remove_member(p_community uuid, p_user uuid, p_ban boolean default false, p_reason text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := public.role_rank(public.my_role(p_community));
  theirs int;
begin
  select public.role_rank(role) into theirs from public.community_members where community_id = p_community and user_id = p_user;
  if mine < 2 or coalesce(theirs, 0) >= mine then raise exception 'not allowed'; end if;
  delete from public.community_members where community_id = p_community and user_id = p_user;
  if p_ban then
    insert into public.bans (community_id, user_id, reason, banned_by)
    values (p_community, p_user, coalesce(p_reason, ''), (select auth.uid()))
    on conflict (community_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
  end if;
end $$;

create or replace function public.unban_member(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_community, 'mod') then raise exception 'not allowed'; end if;
  delete from public.bans where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message;
  if not found or m.deleted_at is not null then return; end if;
  if m.author_id <> (select auth.uid()) then
    -- Mods can remove messages from anyone ranked below them.
    if public.role_rank(public.my_role(m.community_id)) < 2
       or public.role_rank(public.my_role(m.community_id)) <= public.role_rank(
            (select role from public.community_members where community_id = m.community_id and user_id = m.author_id)) then
      raise exception 'not allowed';
    end if;
  end if;
  update public.messages set deleted_at = now(), body = '' where id = p_message;
  delete from public.reactions where message_id = p_message;
end $$;

-- Close a thread with an outcome. The thread starter or a mod can do it; the outcome
-- shows under the original message, and can be pinned to the room board as a decision.
create or replace function public.resolve_thread(p_message uuid, p_outcome text, p_pin boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  uid uuid := (select auth.uid());
begin
  select * into m from public.messages where id = p_message;
  if not found or m.parent_id is not null or m.deleted_at is not null then raise exception 'not a thread'; end if;
  if m.author_id <> uid and not public.has_role(m.community_id, 'mod') then raise exception 'not allowed'; end if;
  if char_length(trim(coalesce(p_outcome, ''))) = 0 then raise exception 'write the outcome'; end if;
  update public.messages set resolved_at = now(), resolved_by = uid, outcome = trim(p_outcome) where id = p_message;
  if p_pin then
    insert into public.board_items (room_id, community_id, kind, title, body, message_id, created_by)
    values (m.room_id, m.community_id, 'decision', substr(trim(p_outcome), 1, 140), trim(p_outcome), m.id, uid);
  end if;
end $$;

create or replace function public.reopen_thread(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
begin
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'not found'; end if;
  if m.author_id <> (select auth.uid()) and not public.has_role(m.community_id, 'mod') then raise exception 'not allowed'; end if;
  update public.messages set resolved_at = null, resolved_by = null, outcome = null where id = p_message;
end $$;

create or replace function public.mark_read(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.rooms r where r.id = p_room and public.is_member(r.community_id)) then return; end if;
  insert into public.room_state (room_id, user_id, last_read_at) values (p_room, uid, now())
  on conflict (room_id, user_id) do update set last_read_at = now();
end $$;

create or replace function public.set_room_notify(p_room uuid, p_notify text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_notify not in ('all', 'mentions', 'none') then raise exception 'notify must be all, mentions or none'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and public.is_member(r.community_id)) then
    raise exception 'not a member';
  end if;
  insert into public.room_state (room_id, user_id, notify) values (p_room, (select auth.uid()), p_notify)
  on conflict (room_id, user_id) do update set notify = excluded.notify;
end $$;

-- Unread state for the sidebar. Counts are capped at 100 so a huge room never costs a full scan.
create or replace function public.my_unreads(p_community uuid)
returns table (room_id uuid, unread int, mentions int, notify text)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    (select count(*)::int from (
      select 1 from public.messages m
      where m.room_id = r.id and m.parent_id is null and m.deleted_at is null
        and m.author_id <> (select auth.uid())
        and m.created_at > coalesce(s.last_read_at, cm.joined_at)
      limit 100) x),
    (select count(*)::int from (
      select 1 from public.mentions mn
      where mn.user_id = (select auth.uid()) and mn.room_id = r.id
        and mn.created_at > coalesce(s.last_read_at, cm.joined_at)
      limit 100) y),
    coalesce(s.notify, 'mentions')
  from public.rooms r
  join public.community_members cm on cm.community_id = r.community_id and cm.user_id = (select auth.uid())
  left join public.room_state s on s.room_id = r.id and s.user_id = (select auth.uid())
  where r.community_id = p_community
$$;

-- "While you were gone": a plain summary of what changed in a room since you last read it.
-- Deterministic on purpose — counts, who talked, the busiest threads, decisions, your pings.
create or replace function public.catch_up(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  r public.rooms;
  since timestamptz;
  result jsonb;
begin
  select * into r from public.rooms where id = p_room;
  if not found or not public.is_member(r.community_id) then return null; end if;
  select coalesce(s.last_read_at, cm.joined_at) into since
    from public.community_members cm
    left join public.room_state s on s.room_id = p_room and s.user_id = uid
    where cm.community_id = r.community_id and cm.user_id = uid;

  select jsonb_build_object(
    'since', since,
    'new_messages', (select count(*) from public.messages m
                     where m.room_id = p_room and m.deleted_at is null and m.created_at > since and m.author_id <> uid),
    'first_unread_id', (select m.id from public.messages m
                        where m.room_id = p_room and m.parent_id is null and m.deleted_at is null
                          and m.created_at > since and m.author_id <> uid
                        order by m.created_at limit 1),
    'people', coalesce((select jsonb_agg(x.display_name order by x.n desc) from (
                 select p.display_name, count(*) n from public.messages m join public.profiles p on p.id = m.author_id
                 where m.room_id = p_room and m.deleted_at is null and m.created_at > since and m.author_id <> uid
                 group by p.display_name order by n desc limit 5) x), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'preview', substr(t.body, 1, 120), 'new_replies', t.n,
                                                             'outcome', t.outcome) order by t.n desc) from (
                 select root.id, root.body, root.outcome, count(*) n
                 from public.messages reply join public.messages root on root.id = reply.parent_id
                 where reply.room_id = p_room and reply.created_at > since and reply.deleted_at is null and root.deleted_at is null
                 group by root.id, root.body, root.outcome order by n desc limit 3) t), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title) order by b.created_at) from (
                 select * from public.board_items b where b.room_id = p_room and b.created_at > since
                 order by b.created_at limit 5) b), '[]'::jsonb),
    'mentions', (select count(*) from public.mentions mn where mn.user_id = uid and mn.room_id = p_room and mn.created_at > since)
  ) into result;
  return result;
end $$;

-- Full history search, free forever. Only searches communities you're in.
create or replace function public.search_messages(p_community uuid, p_query text, p_limit int default 30)
returns table (id uuid, room_id uuid, parent_id uuid, body text, author_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.room_id, m.parent_id, m.body, m.author_id, m.created_at
  from public.messages m
  where public.is_member(p_community)
    and m.community_id = p_community
    and m.deleted_at is null
    and m.search @@ websearch_to_tsquery('simple', p_query)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- Lock down function execution: only signed-in users.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Trigger functions and internal helpers aren't meant to be called directly.
revoke execute on function public.emit(text, text, jsonb) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
