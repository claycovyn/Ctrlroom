-- Ctrl Room — community image (icon) and cover photo.
--
-- Both live in a public Supabase Storage bucket `community-media`, one folder per community and kind:
--   community-media/<community id>/icon/<random>.<png|jpg|webp>
--   community-media/<community id>/cover/<random>.<png|jpg|webp>
-- Public, because the public join page shows them to people who aren't members yet.
-- The browser uploads with the admin's JWT, then saves the public URL in communities.icon_url / cover_url.
-- Storage rejects anything over 2 MB or of another type; the policies below let only the community's
-- owner and admins write in its folders; the trigger keeps each URL pointing at that community's own
-- icon/ or cover/ folder (or empty), so a community can't be used to load an image from somewhere else.
--
-- Takedowns (0003): nothing new can be uploaded or set while a community is taken down (the bucket is
-- public, so new files would still be reachable). Owners and admins can still remove what's there.
-- Everything else 0003 allows or forbids is unchanged.

alter table public.communities add column if not exists icon_url text;
alter table public.communities add column if not exists cover_url text;

-- ───────────────────────── bucket ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ───────────────────────── storage policies ─────────────────────────

-- Is the caller an owner/admin of the community whose folder this object is in?
-- Object names must be exactly `<community id>/<icon|cover>/<file>`. `p_adding` is false for deletes
-- (and for the old row of an update), which stay allowed on a taken-down community.
create or replace function public.can_write_community_media(p_name text, p_adding boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
  c uuid;
begin
  if coalesce(array_length(parts, 1), 0) <> 2 or parts[2] not in ('icon', 'cover')
     or parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  c := parts[1]::uuid;
  if not public.has_role(c, 'admin') then return false; end if;
  if p_adding and exists (select 1 from public.communities where id = c and taken_down_at is not null) then
    return false;
  end if;
  return true;
end $$;

-- Anyone can read (icons and covers show on public join pages, and the bucket is public anyway).
create policy community_media_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'community-media');

-- Owners and admins write only inside their community's icon/ and cover/ folders.
create policy community_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-media' and public.can_write_community_media(name, true));
create policy community_media_update on storage.objects for update to authenticated
  using (bucket_id = 'community-media' and public.can_write_community_media(name, false))
  with check (bucket_id = 'community-media' and public.can_write_community_media(name, true));
create policy community_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-media' and public.can_write_community_media(name, false));

-- ───────────────────────── icon_url / cover_url ─────────────────────────

-- Who may change them at all is the existing communities_update policy (owner/admin) + the column grant
-- below. This keeps each one empty or a public URL in that community's own folder of the right kind.
-- The host rule is the one profile photos use (0004): Supabase's own host (hosted or local dev), plus
-- your own Supabase domain when self-hosting, set once for both:
--   alter database postgres set ctrlroom.avatar_host = 'supabase.example.com';
create or replace function public.communities_media_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  own_host text := nullif(current_setting('ctrlroom.avatar_host', true), '');
  hosts text := '[a-z0-9-]+\.supabase\.co|localhost(:[0-9]+)?|127\.0\.0\.1(:[0-9]+)?'
    || coalesce('|' || regexp_replace(own_host, '([.\\+*?^$()\[\]{}|-])', '\\\1', 'g'), '');
  base text := '^https?://(' || hosts || ')/storage/v1/object/public/community-media/' || new.id::text || '/';
  file text := '/[A-Za-z0-9_-]+\.(png|jpg|webp)$';
begin
  if new.icon_url is distinct from old.icon_url and new.icon_url is not null then
    if new.taken_down_at is not null then
      raise exception 'CR: This community was taken down, so its image can''t be changed.' using errcode = 'check_violation';
    end if;
    if new.icon_url !~ (base || 'icon' || file) then
      raise exception 'CR: Upload an image to use it for the community.' using errcode = 'check_violation';
    end if;
  end if;
  if new.cover_url is distinct from old.cover_url and new.cover_url is not null then
    if new.taken_down_at is not null then
      raise exception 'CR: This community was taken down, so its cover photo can''t be changed.' using errcode = 'check_violation';
    end if;
    if new.cover_url !~ (base || 'cover' || file) then
      raise exception 'CR: Upload a photo to use it as the cover.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger communities_media_guard
  before update of icon_url, cover_url on public.communities
  for each row when (new.icon_url is distinct from old.icon_url or new.cover_url is distinct from old.cover_url)
  execute function public.communities_media_guard();

-- ───────────────────────── privileges ─────────────────────────

-- Restated from 0001 with the two new columns: owners/admins (communities_update) change only these.
revoke update on public.communities from anon, authenticated;
grant update (name, description, icon, is_public, icon_url, cover_url) on public.communities to authenticated;

-- New functions are executable by PUBLIC by default. The storage policies run as the signed-in caller,
-- so they need the write check; the guard only runs as a trigger.
revoke execute on function public.can_write_community_media(text, boolean), public.communities_media_guard()
  from public, anon, authenticated;
grant execute on function public.can_write_community_media(text, boolean) to authenticated;
