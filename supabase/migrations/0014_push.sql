-- Push notifications (Web Push: iPhone and iPad Home Screen apps on iOS 16.4+, Android, desktop browsers).
--
-- The browser never sends a push itself. The flow is:
--   1. A trigger (SECURITY DEFINER) sees an event worth a notification: a row in public.mentions (0001 writes one
--      for every @you and every reply to you), a call starting (push_call_started, from the LiveKit webhook), and
--      a direct message (dm_messages_push, on 0011's dm_messages).
--   2. enqueue_push() checks the recipient's choices (push_prefs, quiet hours, a muted room, blocks) and that they
--      have at least one subscribed device, then writes one row to push_outbox. Duplicates collapse on
--      (user_id, collapse_key).
--   3. push_nudge() asks the server to deliver, at most once per transaction: pg_net (net.http_post, async, sent only
--      after the transaction commits) POSTs to <site>/api/push/dispatch with the shared secret from
--      private.push_config. Without pg_net or without that config it does nothing, and the browser's own nudge after
--      sending a message (or the next nudge) delivers the backlog.
--   4. /api/push/dispatch (service role) claims rows with claim_push(), sends them with web-push, and reports back
--      with finish_push(): delivered rows are deleted, dead subscriptions (404/410) are deleted.
--
-- For anything later that should notify someone:
--   select public.enqueue_push(recipient, kind, title, body, url, tag, collapse_key, sender);
--   kind is one of mention | reply | dm | call; url must be a path on this site; tag groups notifications on the
--   device (a newer one replaces an older one with the same tag); collapse_key drops exact duplicates; the sender is
--   never notified and push_blocked(recipient, sender) is checked (0011 blocks: the recipient blocked the sender).
--
-- Do not disturb and Away are presence (0010), which only lives in the browser, so they aren't applied here.
-- Nothing here is ever read by a browser except a person's own subscriptions and preferences.

-- ───────────────────────── pg_net (hosted Supabase has it; self-hosted Postgres may not) ─────────────────────────

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then
  raise notice 'pg_net not enabled (%); pushes are delivered by the app''s own nudge instead', sqlerrm;
end $$;

-- ───────────────────────── private config: the dispatch URL and secret ─────────────────────────

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table private.push_config (
  id int primary key default 1 check (id = 1),
  dispatch_url text check (dispatch_url is null or dispatch_url ~ '^https?://[^\s]+$'),
  secret text check (secret is null or char_length(secret) between 32 and 200),
  updated_at timestamptz not null default now()
);
insert into private.push_config default values;
revoke all on table private.push_config from public;
revoke all on table private.push_config from anon, authenticated;

-- ───────────────────────── tables ─────────────────────────

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://[^\s]+$' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_=-]{20,200}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_=-]{8,100}$'),
  user_agent text not null default '' check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- One row per person, created the first time they change a setting. No row = everything on, no quiet hours.
create table public.push_prefs (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  mentions boolean not null default true,
  replies boolean not null default true,
  dms boolean not null default true,
  calls boolean not null default true,
  -- Minutes after local midnight; both set or both null. start > end wraps past midnight (22:00 → 07:00).
  quiet_start smallint check (quiet_start between 0 and 1439),
  quiet_end smallint check (quiet_end between 0 and 1439),
  tz text not null default 'UTC' check (char_length(tz) between 1 and 64),
  updated_at timestamptz not null default now(),
  constraint push_prefs_quiet_pair check ((quiet_start is null) = (quiet_end is null))
);

create table public.push_outbox (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('mention', 'reply', 'dm', 'call')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 240),
  url text not null check (url ~ '^/[^/]' or url = '/'),
  tag text not null default '' check (char_length(tag) <= 120),
  collapse_key text not null default '' check (char_length(collapse_key) <= 160),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts int not null default 0
);
create unique index push_outbox_collapse_idx on public.push_outbox (user_id, collapse_key) where collapse_key <> '';
create index push_outbox_pending_idx on public.push_outbox (id) where attempts < 3;

alter table public.push_subscriptions enable row level security;
alter table public.push_prefs enable row level security;
alter table public.push_outbox enable row level security;

-- Your own devices: list and remove. Adding one goes through save_push_subscription (it can take over an endpoint
-- another account registered on the same browser, which RLS would hide).
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

create policy push_prefs_select on public.push_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_prefs_insert on public.push_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_prefs_update on public.push_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_prefs from anon, authenticated;
grant select, insert on public.push_prefs to authenticated;
grant update (mentions, replies, dms, calls, quiet_start, quiet_end, tz) on public.push_prefs to authenticated;

-- The outbox is server only: no policies, no grants.
revoke all on public.push_outbox from anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from anon, authenticated;

create or replace function public.push_prefs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- An unknown time zone raises here instead of breaking every later push.
  perform now() at time zone new.tz;
  new.updated_at := now();
  return new;
end $$;

create trigger push_prefs_guard before insert or update on public.push_prefs
  for each row execute function public.push_prefs_guard();

-- ───────────────────────── subscribing ─────────────────────────

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  sid uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;
  -- Whoever holds the browser's endpoint owns it: signing in as someone else on the same browser moves it.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, substr(coalesce(p_user_agent, ''), 1, 400))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now()
  returning id into sid;
  -- At most 20 devices; the oldest go first.
  delete from public.push_subscriptions
    where user_id = uid and id in (
      select id from public.push_subscriptions where user_id = uid order by created_at desc offset 20);
  return sid;
end $$;

-- ───────────────────────── enqueueing ─────────────────────────

-- Someone who blocked the sender (0011 blocks) hears nothing from them: no mention, reply, call or DM pushes.
create or replace function public.push_blocked(p_recipient uuid, p_sender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker_id = p_recipient and blocked_id = p_sender)
$$;

-- Whether minute-of-day `m` falls in [s, e), wrapping past midnight when s > e. Pure.
create or replace function public.push_in_quiet(m int, s int, e int) returns boolean
language sql immutable as $$
  select case when s is null or e is null or s = e then false
              when s < e then m >= s and m < e
              else m >= s or m < e end
$$;

-- Asks /api/push/dispatch to deliver, once per transaction, after it commits. Never raises.
create or replace function public.push_nudge() returns void
language plpgsql security definer set search_path = public as $$
declare
  cfg private.push_config;
begin
  if coalesce(current_setting('ctrlroom.push_nudged', true), '') = '1' then return; end if;
  select * into cfg from private.push_config where id = 1;
  if cfg.dispatch_url is null or cfg.secret is null then return; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'net' and p.proname = 'http_post') then
    return;
  end if;
  perform set_config('ctrlroom.push_nudged', '1', true);
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using cfg.dispatch_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg.secret);
exception when others then
  -- A notification never gets in the way of a message.
  raise warning 'push_nudge: %', sqlerrm;
end $$;

-- The one way anything asks for a push. Returns true when a row was queued.
create or replace function public.enqueue_push(
  p_user uuid, p_kind text, p_title text, p_body text, p_url text,
  p_tag text default '', p_collapse_key text default '', p_from uuid default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  pr public.push_prefs;
  local_min int;
  n int;
begin
  if p_user is null or p_user is not distinct from p_from then return false; end if;
  if p_kind not in ('mention', 'reply', 'dm', 'call') then raise exception 'unknown push kind %', p_kind; end if;
  select * into pr from public.push_prefs where user_id = p_user;
  if found then
    if (p_kind = 'mention' and not pr.mentions) or (p_kind = 'reply' and not pr.replies)
       or (p_kind = 'dm' and not pr.dms) or (p_kind = 'call' and not pr.calls) then
      return false;
    end if;
    if pr.quiet_start is not null then
      local_min := extract(hour from now() at time zone pr.tz)::int * 60 + extract(minute from now() at time zone pr.tz)::int;
      if public.push_in_quiet(local_min, pr.quiet_start, pr.quiet_end) then return false; end if;
    end if;
  end if;
  if p_from is not null and public.push_blocked(p_user, p_from) then return false; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return false; end if;

  insert into public.push_outbox (user_id, kind, title, body, url, tag, collapse_key)
  values (p_user, p_kind, substr(coalesce(nullif(trim(p_title), ''), 'Ctrl Room'), 1, 120),
          substr(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 1, 240),
          p_url, substr(coalesce(p_tag, ''), 1, 120), substr(coalesce(p_collapse_key, ''), 1, 160))
  on conflict (user_id, collapse_key) where collapse_key <> '' do nothing;
  get diagnostics n = row_count;
  if n > 0 then perform public.push_nudge(); end if;
  return n > 0;
end $$;

-- ───────────────────────── events ─────────────────────────

-- Mentions and replies: 0001 already writes public.mentions (never for the author, only for community members).
create or replace function public.mentions_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.messages;
  r public.rooms;
  c public.communities;
  who text;
begin
  select * into m from public.messages where id = new.message_id;
  if not found or m.deleted_at is not null then return new; end if;
  select * into r from public.rooms where id = m.room_id;
  select * into c from public.communities where id = m.community_id;
  if c.taken_down_at is not null then return new; end if;
  -- A muted room (room header bell → Muted) stays quiet on the phone too.
  if exists (select 1 from public.room_state s where s.room_id = r.id and s.user_id = new.user_id and s.notify = 'none') then
    return new;
  end if;
  select display_name into who from public.profiles where id = m.author_id;
  perform public.enqueue_push(
    new.user_id,
    new.kind,
    format('%s %s in #%s', coalesce(who, 'Someone'), case when new.kind = 'reply' then 'replied to you' else 'mentioned you' end, r.name),
    m.body,
    format('/c/%s/%s?m=%s', c.slug, r.slug, m.id),
    'room:' || r.id,
    'msg:' || m.id,
    m.author_id);
  return new;
end $$;

create trigger mentions_push after insert on public.mentions
  for each row execute function public.mentions_push();

-- Calls: the LiveKit webhook (service role) calls this on participant_joined. The first join of a LiveKit room
-- session (p_session, the room sid) is the person who started the call; later joins of the same session do nothing.
-- Who hears about it: members who haven't muted the room and either set it to Everything or opened it in the last
-- 14 days, at most 200 people. Returns how many were queued.
create or replace function public.push_call_started(p_session text, p_room uuid, p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  c public.communities;
  who text;
  target uuid;
  n int := 0;
begin
  if p_session is null or char_length(p_session) not between 1 and 200 then return 0; end if;
  select * into r from public.rooms where id = p_room;
  if not found then return 0; end if;
  if not exists (select 1 from public.community_members where community_id = r.community_id and user_id = p_user) then
    return 0;
  end if;
  insert into public.call_events (id) values ('push:' || p_session) on conflict do nothing;
  if not found then return 0; end if;
  select * into c from public.communities where id = r.community_id;
  if c.taken_down_at is not null then return 0; end if;
  select display_name into who from public.profiles where id = p_user;
  for target in
    select s.user_id
      from public.room_state s
      join public.community_members cm on cm.community_id = r.community_id and cm.user_id = s.user_id
      where s.room_id = r.id and s.user_id <> p_user and s.notify <> 'none'
        and (s.notify = 'all' or s.last_read_at > now() - interval '14 days')
      order by s.last_read_at desc
      limit 200
  loop
    if public.enqueue_push(target, 'call', format('%s started a call in #%s', coalesce(who, 'Someone'), r.name), c.name,
                           format('/c/%s/%s', c.slug, r.slug), 'call:' || r.id, 'call:' || p_session, p_user) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Direct messages (0011). Pushed to every member except the author who is active, or who has a request waiting and
-- this is the first message since they were added (a request rings once, not for every follow-up). Never to people
-- who left, ignored the request, muted the conversation or blocked the author. Opens /app/dm/<conversation id>.
create or replace function public.dm_messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  conv public.dm_conversations;
  who text;
  mem public.dm_members;
  title text;
begin
  select * into conv from public.dm_conversations where id = new.conversation_id;
  select display_name into who from public.profiles where id = new.author_id;
  who := coalesce(who, 'Someone');
  for mem in
    select * from public.dm_members
     where conversation_id = new.conversation_id and user_id <> new.author_id
       and status in ('active', 'request') and not muted and ignored_at is null
  loop
    if mem.status = 'request' and exists (
         select 1 from public.dm_messages x
          where x.conversation_id = new.conversation_id and x.id <> new.id and x.created_at >= mem.joined_at) then
      continue;
    end if;
    title := case
      when mem.status = 'request' then format('%s wants to message you', who)
      when conv.is_group then format('%s in %s', who, coalesce(conv.title, 'your group'))
      else who end;
    perform public.enqueue_push(mem.user_id, 'dm', title, new.body, '/app/dm/' || new.conversation_id,
                                'dm:' || new.conversation_id, 'dm:' || new.id, new.author_id);
  end loop;
  return null;
end $$;

create trigger dm_messages_push after insert on public.dm_messages
  for each row execute function public.dm_messages_push();

-- ───────────────────────── delivery (service role only) ─────────────────────────

-- Claims up to p_limit rows for sending. A claimed row that isn't finished within 2 minutes is claimed again, at most
-- 3 times. Rows older than an hour are dropped: a stale notification is worse than none (the mention is still in the
-- app).
create or replace function public.claim_push(p_limit int default 100)
returns table (id bigint, user_id uuid, kind text, title text, body text, url text, tag text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  delete from public.push_outbox o where o.created_at < now() - interval '1 hour' or o.attempts >= 3;
  return query
    update public.push_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
     where o.id in (
       select x.id from public.push_outbox x
        where x.attempts < 3 and (x.claimed_at is null or x.claimed_at < now() - interval '2 minutes')
        order by x.id
        limit least(greatest(coalesce(p_limit, 100), 1), 500)
        for update skip locked)
    returning o.id, o.user_id, o.kind, o.title, o.body, o.url, o.tag, o.created_at;
end $$;

-- Reports a dispatch run: p_done rows are finished (sent, or nothing left to send them to), p_ok endpoints took a
-- push, p_gone endpoints are dead (404/410) and are removed.
create or replace function public.finish_push(p_done bigint[], p_ok text[], p_gone text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_outbox where id = any (coalesce(p_done, '{}'));
  update public.push_subscriptions set last_used_at = now() where endpoint = any (coalesce(p_ok, '{}'));
  delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
end $$;

-- ───────────────────────── privileges ─────────────────────────

revoke execute on function
  public.push_prefs_guard(),
  public.save_push_subscription(text, text, text, text),
  public.push_blocked(uuid, uuid),
  public.push_in_quiet(int, int, int),
  public.push_nudge(),
  public.enqueue_push(uuid, text, text, text, text, text, text, uuid),
  public.mentions_push(),
  public.dm_messages_push(),
  public.push_call_started(text, uuid, uuid),
  public.claim_push(int),
  public.finish_push(bigint[], text[], text[])
from public, anon, authenticated;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.push_call_started(text, uuid, uuid), public.claim_push(int),
  public.finish_push(bigint[], text[], text[]), public.enqueue_push(uuid, text, text, text, text, text, text, uuid)
  to service_role;
