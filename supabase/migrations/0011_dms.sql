-- Ctrl Room — direct messages: 1:1 and group DMs (up to 10 people).
--
-- DMs live outside communities: no community_id, no Cloud metering (nothing here calls meter()), and they never go
-- out on room:<id> or community:<id>. The rules:
--
--   Who can DM you (dm_settings.who_can_dm, per person, no row = the default):
--     'shared_community' (default)  people you share a community with
--     'anyone'                      anyone signed in to this Ctrl Room (they find you by your exact username)
--     'nobody'                      no new conversations; ones you've accepted keep working
--   Requests: a new conversation puts each recipient in status 'request' unless they've already talked with the
--   sender (they're active in another conversation the sender is in). A request recipient reads the conversation
--   but can't post or react until they accept. Ignoring keeps it a request with ignored_at set: hidden from the
--   Requests list and never notified again (the app reads `ignored` on each event). Accept works later too.
--   Blocks (either direction): no new conversations, no posting or reacting in a 1:1, the blocker's inbox hides the
--   1:1, and the blocker gets no events for the blocked person's messages (in groups the app hides them too).
--   Groups: 2–10 people who aren't 'left'. Any active member adds people (each must allow the adder). Leaving keeps
--   what you could read up to left_at and nothing after. 1:1s are unique per pair (pair_key) and can't be left.
--   Flood guard: 30 DMs a minute per person, the same rule as rooms (0003 messages_cloud_guard). start_dm also
--   allows at most 20 new conversations an hour per person.
--
-- Everything that crosses a person boundary is a SECURITY DEFINER function that checks the caller: start_dm,
-- accept_dm_request, ignore_dm_request, leave_dm, add_to_group, rename_dm_group, set_dm_muted, mark_dm_read,
-- block_user, unblock_user, set_who_can_dm, delete_dm_message, report_dm, and the readers my_dm_inbox, my_blocks,
-- dm_search_people. Plain inserts (posting, reacting) and edits go through RLS.
--
-- Realtime: every event goes to each member's own user:<id> topic (0001 can_use_topic: only you receive yours):
--   dm               a new message: { message, conversation_id, is_group, status, ignored, muted, author }
--                    (status / ignored / muted are the recipient's own, so the app can stay quiet)
--   dm_update        an edit or delete: { message }
--   dm_reaction      { op, message_id, user_id, emoji, conversation_id }
--   dm_conversation  members, title, status or mute changed: { conversation_id } (the app refetches its inbox)
--
-- Reports: report_dm() files a DM message into the existing reports table (0003) for the operator's /admin, with a
-- copy of the text at the time of the report. reports.community_id becomes nullable for that.
--
-- Room slug 'dm' is reserved from here on: /c/<slug>/dm is the DM inbox.

-- ───────────────────────── tables ─────────────────────────

create table public.dm_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  who_can_dm text not null default 'shared_community' check (who_can_dm in ('shared_community', 'anyone', 'nobody')),
  updated_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text check (title is null or char_length(title) between 1 and 64),
  -- 1:1 only: '<smaller id>:<larger id>', so a pair has exactly one conversation.
  pair_key text unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint dm_conversations_kind check ((is_group and pair_key is null) or (not is_group and pair_key is not null and title is null))
);
create index dm_conversations_created_by_idx on public.dm_conversations (created_by, created_at desc);

create table public.dm_members (
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'request', 'left')),
  ignored_at timestamptz,
  left_at timestamptz,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null,
  primary key (conversation_id, user_id)
);
create index dm_members_user_idx on public.dm_members (user_id, status);

-- Matches public.messages where it makes sense (no threads, outcomes or search here).
create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dm_messages_body_len check (deleted_at is not null or char_length(body) between 1 and 4000)
);
create index dm_messages_conversation_idx on public.dm_messages (conversation_id, created_at desc);
create index dm_messages_author_created_idx on public.dm_messages (author_id, created_at desc);

create table public.dm_reactions (
  message_id uuid not null references public.dm_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Reports (0003) can now point at a DM instead of a community.
alter table public.reports alter column community_id drop not null;
alter table public.reports add column dm_message_id uuid references public.dm_messages (id) on delete set null;
alter table public.reports add column dm_author_id uuid references public.profiles (id) on delete set null;
alter table public.reports add column dm_snapshot text check (dm_snapshot is null or char_length(dm_snapshot) <= 4000);

-- ───────────────────────── helpers ─────────────────────────

-- The caller's status in a conversation, or null if they were never in it.
create or replace function public.dm_status(p_conv uuid) returns text
language sql stable security definer set search_path = public as $$
  select status from public.dm_members where conversation_id = p_conv and user_id = (select auth.uid())
$$;

-- Whether the caller may read a message sent at p_at: active and request members read everything; people who left
-- read what was sent up to the moment they left.
create or replace function public.dm_can_read(p_conv uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dm_members m
    where m.conversation_id = p_conv and m.user_id = (select auth.uid())
      and (m.status in ('active', 'request') or (m.status = 'left' and p_at <= m.left_at))
  )
$$;

-- The caller shares a conversation with `other` (so they can see each other's name and photo).
create or replace function public.shares_dm(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dm_members a
    join public.dm_members b on b.conversation_id = a.conversation_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  )
$$;

-- Internal (not executable by signed-in people): either of two people has blocked the other.
create or replace function public.is_blocked_pair(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- Internal: may p_from start a conversation with p_to? No bots, no blocks, and p_to's "Who can message you".
create or replace function public.dm_allowed(p_from uuid, p_to uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  setting text;
begin
  if p_from is null or p_to is null or p_from = p_to then return false; end if;
  if not exists (select 1 from public.profiles where id = p_to and not is_bot) then return false; end if;
  if public.is_blocked_pair(p_from, p_to) then return false; end if;
  setting := coalesce((select who_can_dm from public.dm_settings where user_id = p_to), 'shared_community');
  if setting = 'anyone' then return true; end if;
  if setting = 'nobody' then return false; end if;
  return exists (
    select 1 from public.community_members a
    join public.community_members b on b.community_id = a.community_id
    where a.user_id = p_from and b.user_id = p_to
  );
end $$;

-- Internal: p_who has already talked with p_with (p_who is active in a conversation p_with is in). Decides whether a
-- new conversation is a request for p_who.
create or replace function public.dm_talked(p_who uuid, p_with uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dm_members a
    join public.dm_members b on b.conversation_id = a.conversation_id
    where a.user_id = p_who and a.status = 'active' and b.user_id = p_with
  )
$$;

-- Internal: send an event to every member's own user:<id> topic.
create or replace function public.dm_notify_members(p_conv uuid, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  member_id uuid;
begin
  for member_id in select user_id from public.dm_members where conversation_id = p_conv loop
    perform public.emit('user:' || member_id, p_event, p_payload);
  end loop;
end $$;

-- ───────────────────────── triggers ─────────────────────────

-- Group size: at most 10 people who haven't left (2 in a 1:1). Locked per conversation so concurrent adds can't
-- go past it.
create or replace function public.dm_members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grp boolean;
  n int;
begin
  if new.status = 'left' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'left' then return new; end if;
  select is_group into grp from public.dm_conversations where id = new.conversation_id;
  perform pg_advisory_xact_lock(hashtextextended('dm_members:' || new.conversation_id::text, 11));
  select count(*) into n from public.dm_members
    where conversation_id = new.conversation_id and status <> 'left' and user_id <> new.user_id;
  if n + 1 > (case when grp then 10 else 2 end) then
    raise exception '%', case when grp then 'CR: A group can have up to 10 people.' else 'CR: A direct message is between two people.' end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger dm_members_guard before insert or update of status on public.dm_members
  for each row execute function public.dm_members_guard();

create or replace function public.dm_messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grp boolean;
  other public.dm_members;
begin
  -- Never trust client-supplied state.
  new.edited_at := null;
  new.deleted_at := null;
  new.created_at := now();
  select is_group into grp from public.dm_conversations where id = new.conversation_id;
  if grp is null then raise exception 'conversation not found'; end if;
  if not exists (select 1 from public.dm_members where conversation_id = new.conversation_id and user_id = new.author_id and status = 'active') then
    raise exception 'CR: Accept this conversation before you reply.';
  end if;
  if not grp then
    select * into other from public.dm_members where conversation_id = new.conversation_id and user_id <> new.author_id;
    if other.user_id is not null and public.is_blocked_pair(new.author_id, other.user_id) then
      raise exception 'CR: You can''t message this person.';
    end if;
    -- They haven't accepted yet, so they still have to allow you (their setting can change while it waits).
    if other.status = 'request' and not public.dm_allowed(new.author_id, other.user_id) then
      raise exception 'CR: You can''t message this person.';
    end if;
  end if;
  -- The flood guard rooms have (0003 messages_cloud_guard): 30 a minute per person.
  if (select count(*) from (
        select 1 from public.dm_messages
        where author_id = new.author_id and created_at > now() - interval '1 minute'
        limit 30) recent) >= 30 then
    raise exception 'CR: You''re sending messages very fast. Wait a minute and try again.';
  end if;
  return new;
end $$;

create trigger dm_messages_before_insert before insert on public.dm_messages
  for each row execute function public.dm_messages_before_insert();

create or replace function public.dm_messages_before_update() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger dm_messages_before_update before update on public.dm_messages
  for each row execute function public.dm_messages_before_update();

create or replace function public.dm_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grp boolean;
  author_name text;
  mem public.dm_members;
begin
  update public.dm_conversations set last_message_at = new.created_at where id = new.conversation_id returning is_group into grp;
  select display_name into author_name from public.profiles where id = new.author_id;
  for mem in select * from public.dm_members where conversation_id = new.conversation_id and status <> 'left' loop
    -- Someone who blocked the author hears nothing about their messages.
    if mem.user_id <> new.author_id
       and exists (select 1 from public.blocks where blocker_id = mem.user_id and blocked_id = new.author_id) then
      continue;
    end if;
    perform public.emit('user:' || mem.user_id, 'dm', jsonb_build_object(
      'message', to_jsonb(new),
      'conversation_id', new.conversation_id,
      'is_group', grp,
      'status', mem.status,
      'ignored', mem.ignored_at is not null,
      'muted', mem.muted,
      'author', author_name));
  end loop;
  return null;
end $$;

create trigger dm_messages_after_insert after insert on public.dm_messages
  for each row execute function public.dm_messages_after_insert();

create or replace function public.dm_messages_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  member_id uuid;
begin
  for member_id in
    select m.user_id from public.dm_members m
    where m.conversation_id = new.conversation_id
      and (m.status <> 'left' or new.created_at <= m.left_at)
      and not exists (select 1 from public.blocks b where b.blocker_id = m.user_id and b.blocked_id = new.author_id and m.user_id <> new.author_id)
  loop
    perform public.emit('user:' || member_id, 'dm_update', jsonb_build_object('message', to_jsonb(new)));
  end loop;
  return null;
end $$;

create trigger dm_messages_after_update after update on public.dm_messages
  for each row execute function public.dm_messages_after_update();

create or replace function public.dm_reactions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.dm_messages;
  other uuid;
begin
  select * into m from public.dm_messages where id = new.message_id;
  if not found or m.deleted_at is not null then raise exception 'message not found'; end if;
  new.conversation_id := m.conversation_id;
  new.created_at := now();
  if not exists (select 1 from public.dm_members where conversation_id = m.conversation_id and user_id = new.user_id and status = 'active') then
    raise exception 'CR: Accept this conversation before you react.';
  end if;
  if not (select is_group from public.dm_conversations where id = m.conversation_id) then
    select user_id into other from public.dm_members where conversation_id = m.conversation_id and user_id <> new.user_id;
    if other is not null and public.is_blocked_pair(new.user_id, other) then raise exception 'CR: You can''t message this person.'; end if;
  end if;
  return new;
end $$;

create trigger dm_reactions_before_insert before insert on public.dm_reactions
  for each row execute function public.dm_reactions_before_insert();

create or replace function public.dm_reactions_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.dm_reactions := coalesce(new, old);
begin
  perform public.dm_notify_members(r.conversation_id, 'dm_reaction', jsonb_build_object(
    'op', case when tg_op = 'DELETE' then 'remove' else 'add' end,
    'message_id', r.message_id, 'user_id', r.user_id, 'emoji', r.emoji, 'conversation_id', r.conversation_id));
  return null;
end $$;

create trigger dm_reactions_after_change after insert or delete on public.dm_reactions
  for each row execute function public.dm_reactions_broadcast();

-- /c/<slug>/dm is the DM inbox, so no new room may use that slug (slugs can't change after creation, 0001).
create or replace function public.rooms_reserved_slug() returns trigger
language plpgsql as $$
begin
  if new.slug = 'dm' then
    raise exception 'CR: "dm" is taken by direct messages. Pick another name.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger rooms_reserved_slug before insert on public.rooms
  for each row execute function public.rooms_reserved_slug();

-- ───────────────────────── row-level security ─────────────────────────

alter table public.dm_settings enable row level security;
alter table public.blocks enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_members enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_reactions enable row level security;

-- Your own setting and your own blocks only; changes go through set_who_can_dm / block_user / unblock_user.
create policy dm_settings_select on public.dm_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- Conversations and member lists: anyone who is or was in the conversation.
create policy dm_conversations_select on public.dm_conversations for select to authenticated
  using (public.dm_status(id) is not null);
create policy dm_members_select on public.dm_members for select to authenticated
  using (public.dm_status(conversation_id) is not null);

-- Messages: active members and request recipients read; people who left read up to when they left.
create policy dm_messages_select on public.dm_messages for select to authenticated
  using (public.dm_can_read(conversation_id, created_at));
-- Only active members post, as themselves (the trigger adds blocks and the flood guard).
create policy dm_messages_insert on public.dm_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and public.dm_status(conversation_id) = 'active');
-- Edit only your own, live message, while you're active. Deletes go through delete_dm_message.
create policy dm_messages_update on public.dm_messages for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null and public.dm_status(conversation_id) = 'active')
  with check (author_id = (select auth.uid()));

create policy dm_reactions_select on public.dm_reactions for select to authenticated
  using (exists (select 1 from public.dm_messages m where m.id = message_id));
create policy dm_reactions_insert on public.dm_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.dm_messages m where m.id = message_id and m.deleted_at is null and public.dm_status(m.conversation_id) = 'active')
  );
create policy dm_reactions_delete on public.dm_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- People you're in a conversation with can see your name and photo, like people you share a community with.
create policy profiles_select_dm on public.profiles for select to authenticated
  using (public.shares_dm(id));

-- Column limits on top of RLS.
revoke all on public.dm_settings, public.blocks, public.dm_conversations, public.dm_members, public.dm_messages,
  public.dm_reactions from anon, authenticated;
grant select on public.dm_settings, public.blocks, public.dm_conversations to authenticated;
-- Other members' read state, mute and ignore choices stay private (your own come from my_dm_inbox).
grant select (conversation_id, user_id, status, left_at, joined_at, added_by) on public.dm_members to authenticated;
grant select, insert on public.dm_messages to authenticated;
grant update (body) on public.dm_messages to authenticated;
grant select, insert, delete on public.dm_reactions to authenticated;

-- ───────────────────────── functions people call ─────────────────────────

-- Send a direct message. One other person: the pair's conversation (created the first time, reused after).
-- Two to nine others: a new group, optionally named. Returns the conversation id.
create or replace function public.start_dm(p_user_ids uuid[], p_body text, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  others uuid[];
  other uuid;
  msg text := trim(coalesce(p_body, ''));
  ttl text := nullif(trim(coalesce(p_title, '')), '');
  key text;
  conv uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.profiles where id = uid and not is_bot) then raise exception 'not allowed'; end if;
  select coalesce(array_agg(distinct x), '{}') into others
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as x where x is not null and x <> uid;
  if cardinality(others) = 0 then raise exception 'CR: Pick someone to message.'; end if;
  if cardinality(others) > 9 then raise exception 'CR: A group can have up to 10 people.'; end if;
  if char_length(msg) = 0 then raise exception 'CR: Write a message first.'; end if;
  if char_length(msg) > 4000 then raise exception 'CR: Keep messages to 4,000 characters.'; end if;
  if ttl is not null and char_length(ttl) > 64 then raise exception 'CR: Keep the group name to 64 characters.'; end if;

  -- One person's new conversations are counted and created one at a time.
  perform pg_advisory_xact_lock(hashtextextended('dm_start:' || uid::text, 11));

  if cardinality(others) = 1 then
    other := others[1];
    key := least(uid::text, other::text) || ':' || greatest(uid::text, other::text);
    perform pg_advisory_xact_lock(hashtextextended('dm_pair:' || key, 11));
    select id into conv from public.dm_conversations where pair_key = key;
    if conv is not null then
      -- Writing back is accepting. The message trigger checks blocks and, while they haven't accepted, their setting.
      update public.dm_members set status = 'active', ignored_at = null
        where conversation_id = conv and user_id = uid and status <> 'active';
      insert into public.dm_messages (conversation_id, author_id, body) values (conv, uid, msg);
      return conv;
    end if;
  end if;

  foreach other in array others loop
    if not public.dm_allowed(uid, other) then
      raise exception '%', case when cardinality(others) = 1 then 'CR: You can''t message this person.'
                                else 'CR: You can''t message one of the people you picked.' end;
    end if;
  end loop;
  if (select count(*) from public.dm_conversations where created_by = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'CR: You''ve started a lot of conversations this hour. Try again later.';
  end if;

  insert into public.dm_conversations (is_group, title, pair_key, created_by)
    values (cardinality(others) > 1, case when cardinality(others) > 1 then ttl end, key, uid)
    returning id into conv;
  insert into public.dm_members (conversation_id, user_id, status, added_by) values (conv, uid, 'active', uid);
  -- Read state starts just before the first message (same transaction, same now()), so it counts as unread.
  insert into public.dm_members (conversation_id, user_id, status, added_by, last_read_at)
    select conv, o, case when public.dm_talked(o, uid) then 'active' else 'request' end, uid, now() - interval '1 second'
    from unnest(others) as o;
  insert into public.dm_messages (conversation_id, author_id, body) values (conv, uid, msg);
  return conv;
end $$;

create or replace function public.accept_dm_request(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.dm_members set status = 'active', ignored_at = null
    where conversation_id = p_conv and user_id = (select auth.uid()) and status = 'request';
  if not found then raise exception 'CR: There''s no request to accept.'; end if;
  perform public.dm_notify_members(p_conv, 'dm_conversation', jsonb_build_object('conversation_id', p_conv));
end $$;

-- Hide a request and stop hearing about it. It stays a request (you can still accept it later).
create or replace function public.ignore_dm_request(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.dm_members set ignored_at = coalesce(ignored_at, now())
    where conversation_id = p_conv and user_id = (select auth.uid()) and status = 'request';
  if not found then raise exception 'CR: There''s no request to ignore.'; end if;
end $$;

-- Leave a group. You keep what you could read until now, and nothing after.
create or replace function public.leave_dm(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  grp boolean;
begin
  select is_group into grp from public.dm_conversations where id = p_conv and public.dm_status(id) in ('active', 'request');
  if grp is null then raise exception 'not allowed'; end if;
  if not grp then raise exception 'CR: You can''t leave a direct message. Mute or block instead.'; end if;
  update public.dm_members set status = 'left', left_at = now(), ignored_at = null
    where conversation_id = p_conv and user_id = (select auth.uid());
  perform public.dm_notify_members(p_conv, 'dm_conversation', jsonb_build_object('conversation_id', p_conv));
end $$;

-- Add people to a group you're active in. Each must allow you; someone who left comes back as a request.
create or replace function public.add_to_group(p_conv uuid, p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  grp boolean;
  other uuid;
  cur text;
begin
  if public.dm_status(p_conv) is distinct from 'active' then raise exception 'not allowed'; end if;
  select is_group into grp from public.dm_conversations where id = p_conv;
  if not grp then raise exception 'CR: Start a group to add people.'; end if;
  for other in select distinct x from unnest(coalesce(p_user_ids, '{}'::uuid[])) as x where x is not null and x <> uid loop
    select status into cur from public.dm_members where conversation_id = p_conv and user_id = other;
    if cur in ('active', 'request') then continue; end if;
    if not public.dm_allowed(uid, other) then raise exception 'CR: You can''t add one of the people you picked.'; end if;
    if cur = 'left' then
      update public.dm_members set status = 'request', left_at = null, ignored_at = null, joined_at = now(), added_by = uid
        where conversation_id = p_conv and user_id = other;
    else
      insert into public.dm_members (conversation_id, user_id, status, added_by)
        values (p_conv, other, case when public.dm_talked(other, uid) then 'active' else 'request' end, uid);
    end if;
  end loop;
  perform public.dm_notify_members(p_conv, 'dm_conversation', jsonb_build_object('conversation_id', p_conv));
end $$;

-- Name or rename a group (empty clears it). Any active member.
create or replace function public.rename_dm_group(p_conv uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ttl text := nullif(trim(coalesce(p_title, '')), '');
begin
  if public.dm_status(p_conv) is distinct from 'active' then raise exception 'not allowed'; end if;
  if not (select is_group from public.dm_conversations where id = p_conv) then raise exception 'CR: Only groups have names.'; end if;
  if ttl is not null and char_length(ttl) > 64 then raise exception 'CR: Keep the group name to 64 characters.'; end if;
  update public.dm_conversations set title = ttl where id = p_conv;
  perform public.dm_notify_members(p_conv, 'dm_conversation', jsonb_build_object('conversation_id', p_conv));
end $$;

create or replace function public.set_dm_muted(p_conv uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.dm_members set muted = coalesce(p_muted, false)
    where conversation_id = p_conv and user_id = (select auth.uid()) and status <> 'left';
  if not found then raise exception 'not allowed'; end if;
end $$;

create or replace function public.mark_dm_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.dm_members set last_read_at = now()
    where conversation_id = p_conv and user_id = (select auth.uid()) and status <> 'left';
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_user is null or p_user = uid then raise exception 'CR: You can''t block yourself.'; end if;
  if not exists (select 1 from public.profiles where id = p_user and not is_bot) then raise exception 'not found'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (uid, p_user) on conflict do nothing;
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.blocks where blocker_id = (select auth.uid()) and blocked_id = p_user;
end $$;

-- The people you blocked, with the name and photo Settings shows (they may no longer share anything with you).
create or replace function public.my_blocks()
returns table (id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, b.created_at
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc
$$;

create or replace function public.set_who_can_dm(p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_value not in ('shared_community', 'anyone', 'nobody') then raise exception 'who_can_dm must be shared_community, anyone or nobody'; end if;
  insert into public.dm_settings (user_id, who_can_dm) values (uid, p_value)
  on conflict (user_id) do update set who_can_dm = excluded.who_can_dm, updated_at = now();
end $$;

-- "New message" search: people you share a community with whose name or username matches, plus whoever has this
-- exact username and takes messages from anyone. can_message says whether start_dm would go through.
create or replace function public.dm_search_people(p_query text)
returns table (id uuid, username text, display_name text, avatar_url text, can_message boolean)
language sql stable security definer set search_path = public as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as raw,
           replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') as pat
  )
  select p.id, p.username, p.display_name, p.avatar_url,
    public.dm_allowed((select auth.uid()), p.id)
      or exists (select 1 from public.dm_conversations c
                 join public.dm_members a on a.conversation_id = c.id and a.user_id = (select auth.uid()) and a.status = 'active'
                 join public.dm_members b on b.conversation_id = c.id and b.user_id = p.id and b.status = 'active'
                 where not c.is_group and not public.is_blocked_pair((select auth.uid()), p.id))
  from public.profiles p, q
  where (select auth.uid()) is not null
    and p.id <> (select auth.uid())
    and not p.is_bot
    and not exists (select 1 from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
    and (
      (p.id in (select b.user_id from public.community_members a
                join public.community_members b on b.community_id = a.community_id
                where a.user_id = (select auth.uid()))
       and (q.raw = '' or p.username like q.pat || '%' or lower(p.display_name) like '%' || q.pat || '%'))
      or (q.raw <> '' and p.username = q.raw
          and coalesce((select s.who_can_dm from public.dm_settings s where s.user_id = p.id), 'shared_community') = 'anyone')
    )
  order by p.display_name, p.username
  limit 20
$$;

-- Your conversations (not ones you left), newest first, with your own state, unread count (capped at 100, people you
-- blocked don't count), the last message you can see and every member. 1:1s with someone you blocked are left out.
create or replace function public.my_dm_inbox()
returns table (
  id uuid, is_group boolean, title text, created_by uuid, created_at timestamptz, last_message_at timestamptz,
  status text, ignored boolean, muted boolean, last_read_at timestamptz, unread int, last_message jsonb, members jsonb
)
language sql stable security definer set search_path = public as $$
  select c.id, c.is_group, c.title, c.created_by, c.created_at, c.last_message_at,
    me.status, me.ignored_at is not null, me.muted, me.last_read_at,
    (select count(*)::int from (
       select 1 from public.dm_messages m
       where m.conversation_id = c.id and m.deleted_at is null and m.author_id <> me.user_id and m.created_at > me.last_read_at
         and not exists (select 1 from public.blocks b where b.blocker_id = me.user_id and b.blocked_id = m.author_id)
       limit 100) x),
    (select jsonb_build_object('id', m.id, 'author_id', m.author_id, 'body', substr(m.body, 1, 140),
                               'created_at', m.created_at, 'deleted', m.deleted_at is not null)
       from public.dm_messages m
       where m.conversation_id = c.id
         and not exists (select 1 from public.blocks b where b.blocker_id = me.user_id and b.blocked_id = m.author_id)
       order by m.created_at desc limit 1),
    (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username, 'display_name', p.display_name,
                                                  'avatar_url', p.avatar_url, 'status', dm.status) order by dm.joined_at, p.id), '[]'::jsonb)
       from public.dm_members dm join public.profiles p on p.id = dm.user_id
       where dm.conversation_id = c.id)
  from public.dm_members me
  join public.dm_conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
    and me.status <> 'left'
    and (c.is_group or not exists (
      select 1 from public.dm_members o join public.blocks b on b.blocker_id = me.user_id and b.blocked_id = o.user_id
      where o.conversation_id = c.id and o.user_id <> me.user_id))
  order by coalesce(c.last_message_at, c.created_at) desc, c.id
  limit 200
$$;

-- Soft delete your own message, like rooms (0001 delete_message): the text goes, "Message removed" stays.
create or replace function public.delete_dm_message(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.dm_messages;
begin
  select * into m from public.dm_messages where id = p_message;
  if not found or m.deleted_at is not null then return; end if;
  if m.author_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  update public.dm_messages set deleted_at = now(), body = '' where id = p_message;
  delete from public.dm_reactions where message_id = p_message;
end $$;

-- Report someone else's DM to the operator (/admin). You must be able to read it. Shares report()'s limit (0003):
-- 10 reports an hour per person. The text is copied so an edit or delete afterwards doesn't erase it.
create or replace function public.report_dm(p_message uuid, p_reason text, p_details text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  m public.dm_messages;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into m from public.dm_messages where id = p_message;
  if not found or not public.dm_can_read(m.conversation_id, m.created_at) then raise exception 'message not found'; end if;
  if m.author_id = uid then raise exception 'CR: You can''t report your own message.'; end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'CR: You''ve sent a lot of reports this hour. Try again later.';
  end if;
  insert into public.reports (community_id, message_id, reporter_id, reason, details, dm_message_id, dm_author_id, dm_snapshot)
  values (null, null, uid, p_reason, substr(coalesce(p_details, ''), 1, 1000), m.id, m.author_id, m.body);
end $$;

-- ───────────────────────── privileges ─────────────────────────

-- New functions are executable by PUBLIC by default; open only what signed-in people call. dm_status, dm_can_read
-- and shares_dm are used by the policies above (they only ever answer about the caller).
revoke execute on function
  public.dm_status(uuid),
  public.dm_can_read(uuid, timestamptz),
  public.shares_dm(uuid),
  public.is_blocked_pair(uuid, uuid),
  public.dm_allowed(uuid, uuid),
  public.dm_talked(uuid, uuid),
  public.dm_notify_members(uuid, text, jsonb),
  public.dm_members_guard(),
  public.dm_messages_before_insert(),
  public.dm_messages_before_update(),
  public.dm_messages_after_insert(),
  public.dm_messages_after_update(),
  public.dm_reactions_before_insert(),
  public.dm_reactions_broadcast(),
  public.rooms_reserved_slug(),
  public.start_dm(uuid[], text, text),
  public.accept_dm_request(uuid),
  public.ignore_dm_request(uuid),
  public.leave_dm(uuid),
  public.add_to_group(uuid, uuid[]),
  public.rename_dm_group(uuid, text),
  public.set_dm_muted(uuid, boolean),
  public.mark_dm_read(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.my_blocks(),
  public.set_who_can_dm(text),
  public.dm_search_people(text),
  public.my_dm_inbox(),
  public.delete_dm_message(uuid),
  public.report_dm(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.dm_status(uuid),
  public.dm_can_read(uuid, timestamptz),
  public.shares_dm(uuid),
  public.start_dm(uuid[], text, text),
  public.accept_dm_request(uuid),
  public.ignore_dm_request(uuid),
  public.leave_dm(uuid),
  public.add_to_group(uuid, uuid[]),
  public.rename_dm_group(uuid, text),
  public.set_dm_muted(uuid, boolean),
  public.mark_dm_read(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.my_blocks(),
  public.set_who_can_dm(text),
  public.dm_search_people(text),
  public.my_dm_inbox(),
  public.delete_dm_message(uuid),
  public.report_dm(uuid, text, text)
to authenticated;
