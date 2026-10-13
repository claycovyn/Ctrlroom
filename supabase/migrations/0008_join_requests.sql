-- Ctrl Room — ask to join a private community.
--
-- Until now a private community could only be joined with an invite (0001). Owners and admins can now turn on
-- "Let people ask to join" (communities.accepts_requests). Then:
--   1. A signed-in person who isn't a member opens /c/<slug>. communities_select still hides the community from
--      them (it isn't loosened here); community_request_card() returns only the fields the request page shows:
--      name, description, icon, image and cover. Nothing about members, rooms or messages.
--   2. They ask to join, with an optional message (request_to_join). One pending request per person per
--      community, at most 5 requests an hour per person, never while banned, already a member, or while the
--      community is taken down (0003).
--   3. Owners and admins see pending requests in Settings (join_requests_for, which also returns the requester's
--      name and photo, since profiles_select doesn't show people outside your communities) and approve or decline
--      (decide_join_request). Approving inserts the community_members row exactly as an invite does, so the
--      takedown guard (0003) and every other community_members trigger behave the same.
--   4. The requester can withdraw a pending request (cancel_join_request). It's kept as declined, decided by
--      themselves, so withdrawing and asking again still counts toward the hourly limit.
--
-- Who decides: owners and admins, the same people who manage the community's settings. Mods keep everything 0001
-- gives them (invites, removing and banning people below them); they don't see or answer requests.
--
-- Realtime: owners and admins get a 'join_request' event on their own user:<id> topic (0001) whenever a request in
-- their community is created, answered or withdrawn. The payload is only the community id; the app refetches the
-- count. Nothing goes out on community:<id>, which every member listens to.
--
-- Joining another way (invite, public join) while a request is pending closes it as approved with no decider.
-- Banning someone declines their pending request.

-- ───────────────────────── communities.accepts_requests ─────────────────────────

alter table public.communities add column if not exists accepts_requests boolean not null default false;

-- Restated from 0006 with the new column: owners/admins (communities_update) change only these.
revoke update on public.communities from anon, authenticated;
grant update (name, description, icon, is_public, icon_url, cover_url, accepts_requests) on public.communities to authenticated;

-- ───────────────────────── join_requests ─────────────────────────

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);
create unique index join_requests_one_pending on public.join_requests (community_id, user_id) where status = 'pending';
create index join_requests_community_idx on public.join_requests (community_id, created_at desc) where status = 'pending';
create index join_requests_user_idx on public.join_requests (user_id, created_at desc);

alter table public.join_requests enable row level security;

-- You read your own requests; owners and admins read their community's. Every write goes through the functions below.
create policy join_requests_select on public.join_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(community_id, 'admin'));

revoke all on public.join_requests from anon, authenticated;
grant select on public.join_requests to authenticated;

-- Tell the community's owners and admins that its requests changed. Payload is the community id only.
create or replace function public.notify_join_requests(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  admin_id uuid;
begin
  for admin_id in
    select user_id from public.community_members where community_id = p_community and role in ('owner', 'admin')
  loop
    perform public.emit('user:' || admin_id, 'join_request', jsonb_build_object('community_id', p_community));
  end loop;
end $$;

-- ───────────────────────── the request page ─────────────────────────

-- What a signed-in person sees of a community that accepts requests: only what the request page shows, plus
-- whether they already have a pending request. Nothing for taken-down communities or communities that don't
-- accept requests, so their slugs stay unfindable.
create or replace function public.community_request_card(p_slug text)
returns table (id uuid, slug text, name text, description text, icon text, icon_url text, cover_url text, pending boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.slug, c.name, c.description, c.icon, c.icon_url, c.cover_url,
    exists (select 1 from public.join_requests r
            where r.community_id = c.id and r.user_id = (select auth.uid()) and r.status = 'pending')
  from public.communities c
  where (select auth.uid()) is not null
    and c.slug = lower(p_slug)
    and c.accepts_requests
    and c.taken_down_at is null
$$;

create or replace function public.request_to_join(p_slug text, p_message text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  c public.communities;
  msg text := trim(coalesce(p_message, ''));
  new_id uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into c from public.communities where slug = lower(p_slug);
  if not found or not c.accepts_requests then raise exception 'community not found'; end if;
  if c.taken_down_at is not null then raise exception 'CR: This community was taken down.'; end if;
  if exists (select 1 from public.community_members where community_id = c.id and user_id = uid) then
    raise exception 'CR: You''re already in this community.';
  end if;
  if exists (select 1 from public.bans where community_id = c.id and user_id = uid) then
    raise exception 'CR: You can''t join this community.';
  end if;
  if char_length(msg) > 500 then raise exception 'CR: Keep the message to 500 characters.'; end if;

  -- One person's requests are counted and inserted one at a time, so the limits hold under concurrent calls.
  perform pg_advisory_xact_lock(hashtextextended('join_requests:' || uid::text, 8));
  if exists (select 1 from public.join_requests where community_id = c.id and user_id = uid and status = 'pending') then
    raise exception 'CR: You already asked to join. An admin will look at it.';
  end if;
  if (select count(*) from public.join_requests where user_id = uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'CR: You''ve asked to join a lot of communities this hour. Try again later.';
  end if;

  insert into public.join_requests (community_id, user_id, message) values (c.id, uid, msg) returning id into new_id;
  perform public.notify_join_requests(c.id);
  return new_id;
end $$;

-- Withdraw your own pending request. Kept as declined (decided by you), so it still counts toward the hourly limit.
create or replace function public.cancel_join_request(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  c_id uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;
  update public.join_requests r set status = 'declined', decided_at = now(), decided_by = uid
    from public.communities c
    where c.id = r.community_id and c.slug = lower(p_slug) and r.user_id = uid and r.status = 'pending'
    returning r.community_id into c_id;
  if c_id is not null then perform public.notify_join_requests(c_id); end if;
end $$;

-- ───────────────────────── owners and admins ─────────────────────────

-- Pending requests for a community, with the requester's name and photo. Empty unless you're an owner or admin.
create or replace function public.join_requests_for(p_community uuid)
returns table (id uuid, user_id uuid, username text, display_name text, avatar_url text, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, p.username, p.display_name, p.avatar_url, r.message, r.created_at
  from public.join_requests r
  join public.profiles p on p.id = r.user_id
  where r.community_id = p_community and r.status = 'pending' and public.has_role(p_community, 'admin')
  order by r.created_at
$$;

-- Approve (they become a member) or decline. Returns the new status.
create or replace function public.decide_join_request(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  r public.join_requests;
begin
  select * into r from public.join_requests where id = p_id for update;
  if not found or not public.has_role(r.community_id, 'admin') then raise exception 'not allowed'; end if;
  if r.status <> 'pending' then raise exception 'CR: This request was already answered.'; end if;

  if coalesce(p_approve, false) then
    if exists (select 1 from public.bans where community_id = r.community_id and user_id = r.user_id) then
      raise exception 'CR: They''re banned from this community. Unban them first.';
    end if;
    -- Status first: the membership trigger below closes pending requests, and this one is already answered.
    update public.join_requests set status = 'approved', decided_at = now(), decided_by = uid where id = r.id;
    -- The same insert an invite makes (0001 join_with_invite), so the takedown guard (0003) applies.
    insert into public.community_members (community_id, user_id) values (r.community_id, r.user_id) on conflict do nothing;
  else
    update public.join_requests set status = 'declined', decided_at = now(), decided_by = uid where id = r.id;
  end if;

  perform public.notify_join_requests(r.community_id);
  return case when coalesce(p_approve, false) then 'approved' else 'declined' end;
end $$;

-- ───────────────────────── keeping requests in step ─────────────────────────

-- Joined some other way (invite, public join): the pending request is done.
create or replace function public.join_requests_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.join_requests set status = 'approved', decided_at = now(), decided_by = null
    where community_id = new.community_id and user_id = new.user_id and status = 'pending';
  return null;
end $$;

create trigger join_requests_on_join after insert on public.community_members
  for each row execute function public.join_requests_on_join();

-- Banned: the pending request is declined by whoever banned them.
create or replace function public.join_requests_on_ban() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.join_requests set status = 'declined', decided_at = now(), decided_by = new.banned_by
    where community_id = new.community_id and user_id = new.user_id and status = 'pending';
  return null;
end $$;

create trigger join_requests_on_ban after insert on public.bans
  for each row execute function public.join_requests_on_ban();

-- ───────────────────────── privileges ─────────────────────────

-- New functions are executable by PUBLIC by default; open only what signed-in people call.
revoke execute on function
  public.notify_join_requests(uuid),
  public.community_request_card(text),
  public.request_to_join(text, text),
  public.cancel_join_request(text),
  public.join_requests_for(uuid),
  public.decide_join_request(uuid, boolean),
  public.join_requests_on_join(),
  public.join_requests_on_ban()
from public, anon, authenticated;

grant execute on function
  public.community_request_card(text),
  public.request_to_join(text, text),
  public.cancel_join_request(text),
  public.join_requests_for(uuid),
  public.decide_join_request(uuid, boolean)
to authenticated;
