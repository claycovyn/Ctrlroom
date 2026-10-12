-- Ctrl Room — profile photos.
--
-- Photos live in a public Supabase Storage bucket `avatars`, one folder per person:
--   avatars/<user id>/<random>.<png|jpg|webp>
-- The browser uploads with the person's JWT, then saves the public URL in profiles.avatar_url.
-- Storage rejects anything over 1 MB or of another type; the policies below keep each person in
-- their own folder; the trigger keeps avatar_url pointing at their own folder (or empty), so a
-- profile can't be used to load an image from somewhere else.
--
-- profiles.avatar_url already exists (0001), and people can already update only their own row and
-- only display_name / avatar_url (profiles_update + the column grant in 0001). Nothing to change there.

-- ───────────────────────── bucket ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ───────────────────────── storage policies ─────────────────────────

-- Anyone can read (photos show up for every member, and the bucket is public anyway).
create policy avatars_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

-- Signed-in people write only inside their own folder.
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────────────────── avatar_url ─────────────────────────

-- A person's avatar_url is empty or a public URL in their own avatars folder. Bots keep their
-- built-in icons (0002). The host must be Supabase's (hosted or local dev), so a profile can't
-- load a lookalike path from another site. Self-hosting Supabase on your own domain? Allow it with
--   alter database postgres set ctrlroom.avatar_host = 'supabase.example.com';
create or replace function public.profiles_avatar_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  own_host text := nullif(current_setting('ctrlroom.avatar_host', true), '');
  hosts text := '[a-z0-9-]+\.supabase\.co|localhost(:[0-9]+)?|127\.0\.0\.1(:[0-9]+)?'
    || coalesce('|' || regexp_replace(own_host, '([.\\+*?^$()\[\]{}|-])', '\\\1', 'g'), '');
begin
  if new.avatar_url is null or new.is_bot then return new; end if;
  if new.avatar_url !~ ('^https?://(' || hosts || ')/storage/v1/object/public/avatars/' || new.id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'CR: Upload a photo to use it on your profile.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger profiles_avatar_guard
  before update of avatar_url on public.profiles
  for each row when (new.avatar_url is distinct from old.avatar_url)
  execute function public.profiles_avatar_guard();

-- ───────────────────────── privileges ─────────────────────────

-- Restated so this file stands on its own: people update only display_name and avatar_url.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- New functions are executable by PUBLIC by default; this one only runs as a trigger.
revoke execute on function public.profiles_avatar_guard() from public, anon, authenticated;
