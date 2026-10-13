-- Ctrl Room — room icons.
--
-- rooms.icon is the id of one of the app's built-in room icons (src/lib/roomIcons.ts), or null for the default
-- (# for text rooms, a speaker for voice rooms). The database only checks the shape of the id (lowercase
-- letters, digits and dashes, 1 to 32 characters), so new icons ship without a migration; the app treats an id
-- it doesn't know as the default. Nothing here is an image or a URL: icons are drawn by the app.
--
-- Who can set it is the existing rooms_insert / rooms_update policies from 0001 (owners and admins), plus the
-- column grant below. Mods and members still can't edit rooms. The room list broadcast (rooms_broadcast,
-- community:<id>) sends to_jsonb(room), so the new column reaches everyone without a change there.

alter table public.rooms add column if not exists icon text
  check (icon is null or icon ~ '^[a-z0-9-]{1,32}$');

-- Restated from 0007 with icon: owners/admins (rooms_update) change only these. slug and community_id stay locked.
revoke update on public.rooms from anon, authenticated;
grant update (name, topic, kind, post_min_role, position, description, section_id, icon) on public.rooms to authenticated;
