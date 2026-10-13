-- Community image + cover tests for 0006_community_media.sql: the community-media bucket, owner/admin-only
-- storage policies per community folder, and icon_url / cover_url.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('60000000-0000-0000-0000-00000000000a', 'own@example.com', '{"username":"own"}'),
  ('60000000-0000-0000-0000-00000000000b', 'adm@example.com', '{"username":"adm"}'),
  ('60000000-0000-0000-0000-00000000000c', 'mod@example.com', '{"username":"modr"}'),
  ('60000000-0000-0000-0000-00000000000d', 'mem@example.com', '{"username":"mem"}'),
  ('60000000-0000-0000-0000-00000000000e', 'out@example.com', '{"username":"outsider"}');
\set own 60000000-0000-0000-0000-00000000000a
\set adm 60000000-0000-0000-0000-00000000000b
\set mod 60000000-0000-0000-0000-00000000000c
\set mem 60000000-0000-0000-0000-00000000000d
\set out 60000000-0000-0000-0000-00000000000e
\set c 61000000-0000-0000-0000-000000000001
\set other 61000000-0000-0000-0000-000000000002
\set base 'https://proj.supabase.co/storage/v1/object/public/community-media/'

insert into public.communities (id, slug, name, owner_id, is_public) values
  (:'c', 'media-test', 'Media test', :'own', true),
  (:'other', 'other-test', 'Other test', :'out', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'adm', 'admin'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member'),
  (:'other', :'out', 'owner');

-- ── the bucket and columns
select tests.ok((select public and file_size_limit = 2097152
                   and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
                 from storage.buckets where id = 'community-media'), 'public community-media bucket, 2 MB, png/jpeg/webp');
select tests.ok((select icon_url is null and cover_url is null from public.communities where id = :'c'), 'communities start without images');

set role authenticated;

-- ── uploads: owner and admin, in their community's icon/ and cover/ folders only
select tests.login(:'adm');
insert into storage.objects (bucket_id, name) values ('community-media', :'c' || '/icon/a.png');
select tests.login(:'own');
insert into storage.objects (bucket_id, name) values ('community-media', :'c' || '/cover/b.jpg');
reset role;
select tests.ok((select count(*) from storage.objects where bucket_id = 'community-media') = 2, 'admin and owner can upload');
set role authenticated;

select tests.login(:'mod');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/icon/m.png')),
  'mod cannot upload');
select tests.login(:'mem');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/icon/u.png')),
  'member cannot upload');
select tests.login(:'out');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/cover/x.png')),
  'non-member cannot upload');

select tests.login(:'adm');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'other' || '/icon/x.png')),
  'cannot upload into another community''s folder');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/x.png')),
  'cannot upload outside icon/ and cover/');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/banner/x.png')),
  'cannot upload into another kind of folder');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/icon/deep/x.png')),
  'cannot upload into nested folders');
select tests.ok(tests.throws($$ insert into storage.objects (bucket_id, name) values ('community-media', 'not-a-community/icon/x.png') $$),
  'folder must be a community id');
select tests.ok(tests.throws($$ insert into storage.objects (bucket_id, name) values ('community-media', 'loose.png') $$),
  'upload outside any folder denied');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L) $$, :'c' || '/icon/x.png')),
  'avatars bucket not opened up by this');
select tests.ok(tests.throws(format($$ update storage.objects set name = %L where name = %L $$, :'other' || '/icon/moved.png', :'c' || '/icon/a.png')),
  'cannot move a file into another community''s folder');

-- mods and members can't rename or delete the community's files (no error, nothing happens)
select tests.login(:'mod');
update storage.objects set name = :'c' || '/icon/renamed.png' where name = :'c' || '/icon/a.png';
delete from storage.objects where name = :'c' || '/cover/b.jpg';
select tests.login(:'mem');
delete from storage.objects where name = :'c' || '/icon/a.png';
select tests.login(:'out');
delete from storage.objects where name = :'c' || '/icon/a.png';

-- anyone can read, nobody signed out can write
reset role;
select tests.ok((select count(*) from storage.objects where bucket_id = 'community-media'
                   and name in (:'c' || '/icon/a.png', :'c' || '/cover/b.jpg')) = 2, 'others cannot rename or delete the files');
set role anon;
select tests.ok((select count(*) from storage.objects where bucket_id = 'community-media') = 2, 'anyone can read community media');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/icon/anon.png')),
  'signed-out upload denied');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'c' || '/icon/a.png', :'c')),
  'signed-out cannot set icon_url');
reset role;
set role authenticated;
select tests.login(:'out');
select tests.ok((select count(*) from storage.objects where bucket_id = 'community-media') = 2, 'non-members can read community media');

-- ── icon_url / cover_url: owner and admin, only from this community's matching folder
select tests.login(:'adm');
update public.communities set icon_url = :'base' || :'c' || '/icon/a.png' where id = :'c';
select tests.login(:'own');
update public.communities set cover_url = :'base' || :'c' || '/cover/b.jpg' where id = :'c';
select tests.ok((select icon_url = :'base' || :'c' || '/icon/a.png' and cover_url = :'base' || :'c' || '/cover/b.jpg'
                 from public.communities where id = :'c'), 'admin sets the icon, owner sets the cover');

select tests.login(:'mod');
update public.communities set icon_url = null, cover_url = null where id = :'c';
select tests.login(:'mem');
update public.communities set icon_url = null, cover_url = null where id = :'c';
select tests.login(:'out');
update public.communities set icon_url = null, cover_url = null where id = :'c';
reset role;
select tests.ok((select icon_url is not null and cover_url is not null from public.communities where id = :'c'),
  'mod, member and non-member cannot change them');
set role authenticated;

select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'c' || '/cover/b.jpg', :'c')),
  'cannot point the icon at the cover folder');
select tests.ok(tests.throws(format($$ update public.communities set cover_url = %L where id = %L $$, :'base' || :'c' || '/icon/a.png', :'c')),
  'cannot point the cover at the icon folder');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'other' || '/icon/x.png', :'c')),
  'cannot point the icon at another community''s folder');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$,
    'https://proj.supabase.co/storage/v1/object/public/avatars/' || :'adm' || '/x.png', :'c')),
  'cannot point the icon at a profile photo');
select tests.ok(tests.throws(format($$ update public.communities set cover_url = 'https://tracker.example/pixel.png' where id = %L $$, :'c')),
  'cannot point the cover at another site');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$,
    'https://tracker.example/storage/v1/object/public/community-media/' || :'c' || '/icon/a.png', :'c')),
  'cannot use a lookalike path on another site');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$,
    'https://proj.supabase.co.tracker.example/storage/v1/object/public/community-media/' || :'c' || '/icon/a.png', :'c')),
  'cannot use a lookalike host');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'c' || '/icon/../cover/b.jpg', :'c')),
  'no path tricks');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'c' || '/icon/a.svg', :'c')),
  'only png, jpg and webp files');
select tests.ok(tests.throws(format($$ update public.communities set taken_down_at = now() where id = %L $$, :'c')),
  'takedown columns stay locked');
select tests.ok(tests.throws(format($$ update public.communities set owner_id = %L where id = %L $$, :'adm', :'c')),
  'owner_id stays locked');

-- your own Supabase domain (self-hosting) is allowed when configured
select set_config('ctrlroom.avatar_host', 'media.example.org', true);
update public.communities set icon_url = 'https://media.example.org/storage/v1/object/public/community-media/' || :'c' || '/icon/a.png' where id = :'c';
select tests.ok((select icon_url like 'https://media.example.org/%' from public.communities where id = :'c'), 'ctrlroom.avatar_host is allowed');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$,
    'https://mediaXexample.org/storage/v1/object/public/community-media/' || :'c' || '/icon/a.png', :'c')),
  'the configured host is matched literally');
select set_config('ctrlroom.avatar_host', '', true);
update public.communities set icon_url = :'base' || :'c' || '/icon/a.png' where id = :'c';

-- remove: clear the URL and delete the file
delete from storage.objects where name = :'c' || '/icon/a.png';
update public.communities set icon_url = null where id = :'c';
reset role;
select tests.ok((select icon_url is null from public.communities where id = :'c'), 'remove clears icon_url');
select tests.ok((select count(*) from storage.objects where name = :'c' || '/icon/a.png') = 0, 'admin can delete the file');

-- ── taken down: nothing new goes up, removing still works
update public.communities set taken_down_at = now(), taken_down_reason = 'test' where id = :'c';
set role authenticated;
select tests.login(:'own');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('community-media', %L) $$, :'c' || '/icon/new.png')),
  'no uploads while taken down');
select tests.ok(tests.throws(format($$ update public.communities set icon_url = %L where id = %L $$, :'base' || :'c' || '/icon/new.png', :'c')),
  'cannot set a new icon while taken down');
update public.communities set name = 'Media test renamed' where id = :'c';
update public.communities set cover_url = null where id = :'c';
delete from storage.objects where name = :'c' || '/cover/b.jpg';
reset role;
select tests.ok((select name = 'Media test renamed' and cover_url is null from public.communities where id = :'c'),
  'taken down: owner still edits what 0003 allows and can remove the cover');
select tests.ok((select count(*) from storage.objects where bucket_id = 'community-media') = 0, 'taken down: owner can delete files');

-- ── privileges
select tests.ok(not has_function_privilege('authenticated', 'public.communities_media_guard()', 'execute'), 'guard not callable');
select tests.ok(not has_function_privilege('anon', 'public.can_write_community_media(text, boolean)', 'execute'), 'write check not callable signed out');
select tests.ok(has_column_privilege('authenticated', 'public.communities', 'icon_url', 'update')
                and has_column_privilege('authenticated', 'public.communities', 'cover_url', 'update')
                and not has_column_privilege('authenticated', 'public.communities', 'taken_down_at', 'update'),
  'only the image columns were opened');

rollback;
\echo all community media tests passed
