-- Ctrl Room — OPENCTRL Cloud: plans, metering, Free-tier limits and abuse controls.
--
-- Nothing here limits anyone unless cloud_config.enabled is true. The server sets it from CTRLROOM_CLOUD=1
-- (src/lib/cloudSync.ts), so a self-hosted install is never limited. Limits themselves come from openctrl.json
-- (the `cloud` section); the server copies the Free limits into cloud_config.free.
--
-- The workspace is the community owner: usage from every community someone owns adds up on their account,
-- the same account an OPENCTRL Cloud subscription belongs to.
--   Free tier at a limit      → new messages / new calls pause; reading, search, history and export keep working.
--   OPENCTRL Cloud subscriber → never paused here; over fair use the app offers a pack.
--   Grandfathered / no row    → unlimited (everyone who signed up before Cloud was switched on).
-- Nothing in this file ever deletes data because of usage.

-- ───────────────────────── tables ─────────────────────────

create table public.cloud_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  free jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.cloud_config default values;

create table public.cloud_plans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan text not null default 'grandfathered' check (plan in ('free', 'cloud', 'grandfathered')),
  -- Add-on packs by id from openctrl.json, e.g. {"messages_1m": 1}. Set by an admin until OPENCTRL billing.
  packs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.usage_daily (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  day date not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{1,40}$'),
  count bigint not null default 0,
  primary key (owner_id, day, metric, community_id)
);

-- LiveKit webhook deliveries already counted (they can be retried).
create table public.call_events (
  id text primary key,
  created_at timestamptz not null default now()
);

-- 80% / 100% usage notices already sent, once per meter per month.
create table public.cloud_notices (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  period text not null,
  meter text not null,
  pct int not null check (pct in (80, 100)),
  sent_at timestamptz not null default now(),
  primary key (owner_id, period, meter, pct)
);

-- Operator settings (unit costs for cost to serve). Server only.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'violence', 'sexual', 'illegal', 'impersonation', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create index reports_open_idx on public.reports (created_at desc) where resolved_at is null;
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

-- Takedowns: set and lifted only by an operator (service role). Members keep read access and export.
alter table public.communities add column taken_down_at timestamptz;
alter table public.communities add column taken_down_reason text check (taken_down_reason is null or char_length(taken_down_reason) <= 500);

-- For the per-author flood guard.
create index messages_author_created_idx on public.messages (author_id, created_at desc);

alter table public.cloud_config enable row level security;
alter table public.cloud_plans enable row level security;
alter table public.usage_daily enable row level security;
alter table public.call_events enable row level security;
alter table public.cloud_notices enable row level security;
alter table public.app_settings enable row level security;
alter table public.reports enable row level security;
-- No policies on these: signed-in users reach them only through the functions below; the server uses the service role.

-- A taken-down public community disappears from non-members.
drop policy communities_select on public.communities;
create policy communities_select on public.communities for select to authenticated
  using ((is_public and taken_down_at is null) or public.is_member(id));

-- ───────────────────────── metering ─────────────────────────

create or replace function public.utc_month_start() returns date
language sql stable as $$
  select date_trunc('month', now() at time zone 'utc')::date
$$;

-- Adds to a workspace's usage. Never raises: metering must not break the action that caused it.
create or replace function public.meter(p_owner uuid, p_community uuid, p_metric text, p_n bigint default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_owner is null or p_community is null or p_n is null or p_n <= 0 then return; end if;
  insert into public.usage_daily (owner_id, community_id, day, metric, count)
  values (p_owner, p_community, (now() at time zone 'utc')::date, p_metric, p_n)
  on conflict (owner_id, day, metric, community_id) do update set count = public.usage_daily.count + excluded.count;
exception when others then
  raise warning 'ctrlroom meter failed: %', sqlerrm;
end $$;

create or replace function public.month_usage(p_owner uuid, p_metric text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(count), 0)::bigint from public.usage_daily
  where owner_id = p_owner and metric = p_metric and day >= public.utc_month_start()
$$;

create or replace function public.plan_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select plan from public.cloud_plans where user_id = p_user), 'grandfathered')
$$;

-- True only when Cloud is on, the owner is on the Free tier and this month's usage reached the Free limit.
create or replace function public.free_limit_reached(p_owner uuid, p_metric text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.enabled
       and public.plan_of(p_owner) = 'free'
       and c.free ? p_metric
       and public.month_usage(p_owner, p_metric) >= (c.free ->> p_metric)::numeric
    from public.cloud_config c where c.id = 1), false)
$$;

create or replace function public.next_reset_label() returns text
language sql stable as $$
  select to_char(public.utc_month_start() + interval '1 month', 'FMMonth FMDD')
$$;

-- New sign-ups get the Free tier only while Cloud is on; everyone else stays unlimited.
create or replace function public.profiles_cloud_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select enabled from public.cloud_config where id = 1) then
    insert into public.cloud_plans (user_id, plan) values (new.id, 'free') on conflict do nothing;
  end if;
  return new;
end $$;

create trigger profiles_cloud_plan after insert on public.profiles
  for each row execute function public.profiles_cloud_plan();

-- ───────────────────────── guards ─────────────────────────

-- Runs after messages_before_insert (triggers fire in name order), so community_id is already trusted.
-- Errors that start with "CR: " are written for people; the app shows them as they are.
create or replace function public.messages_cloud_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.communities;
begin
  select * into c from public.communities where id = new.community_id;
  if c.taken_down_at is not null then
    raise exception 'CR: This community was taken down, so new messages are off.';
  end if;
  if (select count(*) from (
        select 1 from public.messages
        where author_id = new.author_id and created_at > now() - interval '1 minute'
        limit 30) recent) >= 30 then
    raise exception 'CR: You''re sending messages very fast. Wait a minute and try again.';
  end if;
  if public.free_limit_reached(c.owner_id, 'messages') then
    raise exception 'CR: % has used this month''s free messages, so new messages are paused until %. History, search and export still work, and nothing has been deleted.',
      c.name, public.next_reset_label();
  end if;
  return new;
end $$;

create trigger messages_cloud_guard before insert on public.messages
  for each row execute function public.messages_cloud_guard();

create or replace function public.messages_meter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.meter((select owner_id from public.communities where id = new.community_id), new.community_id, 'messages', 1);
  return null;
end $$;

create trigger messages_meter after insert on public.messages
  for each row execute function public.messages_meter();

-- No one joins a taken-down community (invites and public joins both insert here).
create or replace function public.members_takedown_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'owner' and exists (select 1 from public.communities where id = new.community_id and taken_down_at is not null) then
    raise exception 'CR: This community was taken down.';
  end if;
  return new;
end $$;

create trigger members_takedown_guard before insert on public.community_members
  for each row execute function public.members_takedown_guard();

-- Going public needs a confirmed email address while Cloud is on (never on a self-hosted install).
create or replace function public.communities_publish_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_public and not old.is_public then
    if new.taken_down_at is not null then
      raise exception 'CR: This community was taken down, so it can''t be made public.';
    end if;
    if (select enabled from public.cloud_config where id = 1)
       and not exists (select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null) then
      raise exception 'CR: Confirm your email address before making a community public. Check your inbox for the link.';
    end if;
  end if;
  return new;
end $$;

create trigger communities_publish_guard before update on public.communities
  for each row execute function public.communities_publish_guard();

-- ───────────────────────── calls ─────────────────────────

-- Whether the caller may start or join a call in this room. null = yes, otherwise the reason to show.
create or replace function public.call_allowed(p_room uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r public.rooms;
  c public.communities;
begin
  select * into r from public.rooms where id = p_room;
  if not found or not public.is_member(r.community_id) then return 'Room not found'; end if;
  select * into c from public.communities where id = r.community_id;
  if c.taken_down_at is not null then return 'This community was taken down, so calls are off.'; end if;
  if public.free_limit_reached(c.owner_id, 'call_minutes') then
    return format('%s has used this month''s free call minutes, so new calls are paused until %s. Text rooms keep working.',
      c.name, public.next_reset_label());
  end if;
  return null;
end $$;

-- Called by the LiveKit webhook (service role) when someone leaves a call. Idempotent per webhook event id.
create or replace function public.record_call(p_event text, p_room uuid, p_minutes int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
begin
  insert into public.call_events (id) values (p_event) on conflict do nothing;
  if not found then return false; end if;
  select * into r from public.rooms where id = p_room;
  if not found then return false; end if;
  perform public.meter((select owner_id from public.communities where id = r.community_id), r.community_id, 'call_minutes', greatest(coalesce(p_minutes, 0), 0));
  return true;
end $$;

-- ───────────────────────── status, reports, admin ─────────────────────────

-- The caller's plan and this month's usage across the communities they own.
create or replace function public.my_cloud_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled', c.enabled,
    'plan', public.plan_of((select auth.uid())),
    'packs', coalesce((select packs from public.cloud_plans where user_id = (select auth.uid())), '{}'::jsonb),
    'owns', (select count(*) from public.communities where owner_id = (select auth.uid())),
    'usage', coalesce((
      select jsonb_object_agg(metric, total) from (
        select metric, sum(count) as total from public.usage_daily
        where owner_id = (select auth.uid()) and day >= public.utc_month_start()
        group by metric) u), '{}'::jsonb),
    'email_confirmed', exists (select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null),
    'resets', public.utc_month_start() + interval '1 month'
  )
  from public.cloud_config c where c.id = 1 and (select auth.uid()) is not null
$$;

-- Report a community or one of its messages. Anyone who can see it may report; 10 reports an hour per person.
create or replace function public.report(p_community uuid, p_message uuid, p_reason text, p_details text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'sign in first'; end if;
  if not (public.is_member(p_community)
          or exists (select 1 from public.communities where id = p_community and is_public and taken_down_at is null)) then
    raise exception 'community not found';
  end if;
  if p_message is not null and not exists (select 1 from public.messages where id = p_message and community_id = p_community) then
    raise exception 'message not found';
  end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'CR: You''ve sent a lot of reports this hour. Try again later.';
  end if;
  insert into public.reports (community_id, message_id, reporter_id, reason, details)
  values (p_community, p_message, uid, p_reason, substr(coalesce(p_details, ''), 1, 1000));
end $$;

-- Every workspace (anyone who owns a community or has a plan row) with this month's usage. Service role only.
create or replace function public.cloud_admin_overview()
returns table (user_id uuid, email text, username text, plan text, packs jsonb, communities bigint, usage jsonb, email_confirmed boolean)
language sql stable security definer set search_path = public as $$
  select p.id, u.email::text, p.username, public.plan_of(p.id), coalesce(cp.packs, '{}'::jsonb),
    (select count(*) from public.communities c where c.owner_id = p.id),
    coalesce((select jsonb_object_agg(metric, total) from (
      select metric, sum(count) as total from public.usage_daily d
      where d.owner_id = p.id and d.day >= public.utc_month_start() group by metric) x), '{}'::jsonb),
    u.email_confirmed_at is not null
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.cloud_plans cp on cp.user_id = p.id
  where cp.user_id is not null or exists (select 1 from public.communities c where c.owner_id = p.id)
$$;

-- ───────────────────────── privileges ─────────────────────────

-- New functions are executable by PUBLIC by default; open only what signed-in users should call.
revoke execute on function
  public.meter(uuid, uuid, text, bigint),
  public.month_usage(uuid, text),
  public.plan_of(uuid),
  public.free_limit_reached(uuid, text),
  public.profiles_cloud_plan(),
  public.messages_cloud_guard(),
  public.messages_meter(),
  public.members_takedown_guard(),
  public.communities_publish_guard(),
  public.record_call(text, uuid, int),
  public.cloud_admin_overview(),
  public.call_allowed(uuid),
  public.my_cloud_status(),
  public.report(uuid, uuid, text, text),
  public.utc_month_start(),
  public.next_reset_label()
from public, anon, authenticated;

grant execute on function public.call_allowed(uuid), public.my_cloud_status(), public.report(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.record_call(text, uuid, int), public.cloud_admin_overview(),
  public.month_usage(uuid, text), public.plan_of(uuid)
  to service_role;
