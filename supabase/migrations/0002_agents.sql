-- Ctrl Room — AI helpers you can @mention in any room.
--
--   @ctrl      answers questions and does web research.
--   @openctrl  answers questions about OpenCtrl apps from the docs at /docs.
--
-- How it runs:
--   1. A member posts a message that mentions @ctrl or @openctrl.
--   2. A trigger records a bot_jobs row (rate limited per person), so jobs can only come
--      from real messages.
--   3. The sender's browser pings POST /api/agent; the server claims the job with the
--      service role, runs the model, and posts the answer as a thread reply.
--   4. Job status changes are broadcast on the room topic, so everyone sees
--      "ctrl is searching the web…" while it works.

-- ───────────────────────── bot profiles ─────────────────────────

-- Bots are profiles without a login, so profiles no longer require an auth user.
-- Deleting an auth user still removes their profile (trigger below).
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add column is_bot boolean not null default false;

create or replace function public.handle_deleted_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id and not is_bot;
  return old;
end $$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- Free the bot handles if a person already took them.
update public.profiles
  set username = substr(username, 1, 24) || '_' || floor(random() * 9000 + 1000)::int::text
  where username in ('ctrl', 'openctrl') and not is_bot;

insert into public.profiles (id, username, display_name, avatar_url, is_bot) values
  ('00000000-0000-4000-8000-00000000c7a1', 'ctrl', 'Ctrl', '/brand/ctrlroom-icon-192.png', true),
  ('00000000-0000-4000-8000-00000000c7a2', 'openctrl', 'OpenCtrl', '/brand/ctrlroom-icon-192.png', true)
on conflict (id) do nothing;

-- Everyone can see the bots (they post in every community).
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (is_bot or id = (select auth.uid()) or public.shares_community(id));

-- ───────────────────────── jobs ─────────────────────────

create table public.bot_jobs (
  id uuid primary key default gen_random_uuid(),
  bot text not null check (bot in ('ctrl', 'openctrl')),
  message_id uuid not null references public.messages (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  -- The thread the answer goes in: the asking message, or the thread it was asked in.
  thread_id uuid not null references public.messages (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'limited')),
  step text not null default '' check (char_length(step) <= 200),
  reply_id uuid references public.messages (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, bot)
);
create index bot_jobs_rate_idx on public.bot_jobs (requested_by, community_id, created_at desc);
create index bot_jobs_room_idx on public.bot_jobs (room_id, created_at desc);

alter table public.bot_jobs enable row level security;
create policy bot_jobs_select on public.bot_jobs for select to authenticated
  using (public.is_member(community_id));
-- No insert/update/delete for users: jobs come from the trigger, results from the server.
revoke insert, update, delete on public.bot_jobs from anon, authenticated;

-- Limits: per person per community per hour, and per community per day.
create or replace function public.bot_limit_per_hour() returns int language sql immutable as $$ select 20 $$;
create or replace function public.bot_limit_per_day() returns int language sql immutable as $$ select 300 $$;

create or replace function public.messages_agent_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b text;
  mine int;
  community_today int;
begin
  if new.deleted_at is not null or (select is_bot from public.profiles where id = new.author_id) then
    return new;
  end if;
  for b in
    select distinct lower(m[1])
    from regexp_matches(new.body, '(?:^|[^a-zA-Z0-9_])@(ctrl|openctrl)(?![a-zA-Z0-9_])', 'gi') as m
  loop
    select count(*) into mine from public.bot_jobs
      where requested_by = new.author_id and community_id = new.community_id and created_at > now() - interval '1 hour';
    select count(*) into community_today from public.bot_jobs
      where community_id = new.community_id and created_at > now() - interval '1 day';
    insert into public.bot_jobs (bot, message_id, room_id, community_id, requested_by, thread_id, status)
    values (
      b, new.id, new.room_id, new.community_id, new.author_id, coalesce(new.parent_id, new.id),
      case when mine >= public.bot_limit_per_hour() or community_today >= public.bot_limit_per_day() then 'limited' else 'queued' end
    )
    on conflict (message_id, bot) do nothing;
  end loop;
  return new;
end $$;

create trigger messages_agent_jobs after insert on public.messages
  for each row execute function public.messages_agent_jobs();

create or replace function public.bot_jobs_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  perform public.emit('room:' || new.room_id, 'agent', jsonb_build_object(
    'id', new.id, 'bot', new.bot, 'status', new.status, 'step', new.step,
    'message_id', new.message_id, 'thread_id', new.thread_id, 'requested_by', new.requested_by, 'reply_id', new.reply_id));
  return new;
end $$;

create trigger bot_jobs_broadcast before insert or update on public.bot_jobs
  for each row execute function public.bot_jobs_broadcast();

-- Server-side claim: queued → running, exactly once. Only the service role calls this.
create or replace function public.claim_bot_job(p_job uuid) returns public.bot_jobs
language sql security definer set search_path = public as $$
  update public.bot_jobs set status = 'running', step = 'Thinking…'
  where id = p_job and status = 'queued'
  returning *
$$;

revoke execute on function public.claim_bot_job(uuid) from public, anon, authenticated;
revoke execute on function public.messages_agent_jobs() from public, anon, authenticated;
revoke execute on function public.bot_jobs_broadcast() from public, anon, authenticated;
revoke execute on function public.handle_deleted_user() from public, anon, authenticated;
