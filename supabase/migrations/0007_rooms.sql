-- Ctrl Room — room descriptions, sidebar sections and personal room pins.
--
-- Descriptions: a longer, plain-text note about a room (up to 1,000 characters). The one-line topic stays in
-- the header; the description shows in the room's info panel. Who can change it is the existing rooms_update
-- policy from 0001 (owners and admins), plus the column grant below. Mods and members are unchanged: they
-- can't edit rooms. The room list broadcast (rooms_broadcast, community:<id>) sends to_jsonb(room), so the
-- new column reaches everyone in the community without a change there.
--
-- Sections: owners and admins group rooms under named, ordered headings in the sidebar (like categories).
-- rooms.section_id is null for rooms with no section; deleting a section keeps its rooms (they fall back to
-- no section). A room can only be in a section of its own community (rooms_section_guard). Everyone in the
-- community reads sections; only owners and admins create, rename, reorder and delete them (mods too stay
-- read-only, as with rooms). Section changes go out on community:<id> as a 'sections' event. Whether a
-- section is collapsed is per person and lives in the browser, not here.
--
-- Pins: each person can pin rooms to the top of a community's room list, for themselves only. A pin is
-- just (user, room). You see, add and remove only your own, and only for rooms you can see (the rooms_select
-- rule: you're a member of the room's community). Up to 20 pins per person per community. Leaving or being
-- removed from a community clears your pins there; deleting a room or a profile clears them by cascade.
-- Pins aren't part of the community export: they're personal.

-- ───────────────────────── rooms.description ─────────────────────────

alter table public.rooms add column if not exists description text not null default ''
  check (char_length(description) <= 1000);

-- ───────────────────────── room_sections ─────────────────────────

create table public.room_sections (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 48),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index room_sections_community_idx on public.room_sections (community_id, position);

alter table public.rooms add column if not exists section_id uuid references public.room_sections (id) on delete set null;
create index rooms_section_idx on public.rooms (section_id);

alter table public.room_sections enable row level security;

create policy room_sections_select on public.room_sections for select to authenticated
  using (public.is_member(community_id));
create policy room_sections_insert on public.room_sections for insert to authenticated
  with check (public.has_role(community_id, 'admin'));
create policy room_sections_update on public.room_sections for update to authenticated
  using (public.has_role(community_id, 'admin')) with check (public.has_role(community_id, 'admin'));
create policy room_sections_delete on public.room_sections for delete to authenticated
  using (public.has_role(community_id, 'admin'));

-- A room's section must belong to the room's own community.
create or replace function public.rooms_section_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.section_id is not null and not exists (
       select 1 from public.room_sections s where s.id = new.section_id and s.community_id = new.community_id) then
    raise exception 'CR: That section is in another community.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger rooms_section_guard before insert or update of section_id, community_id on public.rooms
  for each row execute function public.rooms_section_guard();

create or replace function public.room_sections_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.room_sections := coalesce(new, old);
begin
  perform public.emit('community:' || s.community_id, 'sections', jsonb_build_object('op', lower(tg_op), 'section', to_jsonb(s)));
  return null;
end $$;

create trigger room_sections_after_change after insert or update or delete on public.room_sections
  for each row execute function public.room_sections_broadcast();

-- Restated from 0001 with the new columns: owners/admins (rooms_update) change only these. slug stays locked,
-- because room links use it; community_id stays locked.
revoke update on public.rooms from anon, authenticated;
grant update (name, topic, kind, post_min_role, position, description, section_id) on public.rooms to authenticated;

-- ───────────────────────── room_pins ─────────────────────────

create table public.room_pins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
create index room_pins_room_idx on public.room_pins (room_id);

alter table public.room_pins enable row level security;

create policy room_pins_select on public.room_pins for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );
create policy room_pins_insert on public.room_pins for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );
create policy room_pins_delete on public.room_pins for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.community_id))
  );
-- No update policy and no update grant: a pin is added or removed, never changed.

-- At most 20 pins per person per community. Security definer so the count sees every pin of this person,
-- whatever the caller can read; it only ever counts, it never reads anything back to the caller.
create or replace function public.room_pins_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
begin
  select community_id into c from public.rooms where id = new.room_id;
  if c is null then raise exception 'room not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || c::text, 7));
  if (select count(*) from public.room_pins p join public.rooms r on r.id = p.room_id
      where p.user_id = new.user_id and r.community_id = c) >= 20 then
    raise exception 'CR: You can pin up to 20 rooms in a community. Unpin one first.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger room_pins_limit before insert on public.room_pins
  for each row execute function public.room_pins_limit();

-- Leaving (or being removed from) a community clears your pins there.
create or replace function public.room_pins_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.room_pins p using public.rooms r
  where r.id = p.room_id and r.community_id = old.community_id and p.user_id = old.user_id;
  return null;
end $$;

create trigger room_pins_on_leave after delete on public.community_members
  for each row execute function public.room_pins_on_leave();

-- ───────────────────────── privileges ─────────────────────────

revoke all on public.room_sections from anon, authenticated;
grant select, insert, delete on public.room_sections to authenticated;
grant update (name, position) on public.room_sections to authenticated;

revoke all on public.room_pins from anon, authenticated;
grant select, insert, delete on public.room_pins to authenticated;

-- New functions are executable by PUBLIC by default; these only run as triggers.
revoke execute on function public.room_pins_limit(), public.room_pins_on_leave(), public.rooms_section_guard(),
  public.room_sections_broadcast() from public, anon, authenticated;
