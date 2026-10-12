-- Profile photo tests for 0004_avatars.sql: the avatars bucket, folder-per-person storage policies, avatar_url.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-00000000000a', 'ava@example.com', '{"username":"ava"}'),
  ('40000000-0000-0000-0000-00000000000b', 'ben@example.com', '{"username":"ben"}');
\set ava 40000000-0000-0000-0000-00000000000a
\set ben 40000000-0000-0000-0000-00000000000b
\set base 'https://proj.supabase.co/storage/v1/object/public/avatars/'

-- ── the bucket
select tests.ok((select public and file_size_limit = 1048576
                   and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
                 from storage.buckets where id = 'avatars'), 'public avatars bucket, 1 MB, png/jpeg/webp');

set role authenticated;

-- ── uploads: own folder only
select tests.login(:'ava');
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'ava' || '/one.png', :'ava');
select tests.ok((select count(*) from storage.objects where name = :'ava' || '/one.png') = 1, 'upload to own folder allowed');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L) $$, :'ben' || '/x.png')),
  'upload to someone else''s folder denied');
select tests.ok(tests.throws($$ insert into storage.objects (bucket_id, name) values ('avatars', 'loose.png') $$),
  'upload outside any folder denied');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('other', %L) $$, :'ava' || '/x.png')),
  'other buckets not opened up');

select tests.login(:'ben');
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'ben' || '/b.png', :'ben');
-- ben can't touch ava's photo
update storage.objects set name = :'ben' || '/stolen.png' where name = :'ava' || '/one.png';
delete from storage.objects where name = :'ava' || '/one.png';
select tests.ok(tests.throws(format($$ update storage.objects set name = %L where name = %L $$, :'ava' || '/planted.png', :'ben' || '/b.png')),
  'cannot move a file into someone else''s folder');

-- anyone can read
reset role;
set role anon;
select tests.ok((select count(*) from storage.objects where bucket_id = 'avatars') = 2, 'anyone can read avatars');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('avatars', %L) $$, :'ava' || '/anon.png')),
  'signed-out upload denied');
reset role;
select tests.ok((select count(*) from storage.objects where name = :'ava' || '/one.png') = 1, 'others cannot rename or delete your photo');

-- ── avatar_url: only your own, only from your own folder
set role authenticated;
select tests.login(:'ava');
update public.profiles set avatar_url = :'base' || :'ava' || '/one.png' where id = :'ava';
select tests.ok((select avatar_url from public.profiles where id = :'ava') = :'base' || :'ava' || '/one.png', 'set own avatar_url');
update public.profiles set avatar_url = :'base' || :'ava' || '/one.png' where id = :'ben';
select tests.ok(tests.throws($$ update public.profiles set username = 'renamed' $$), 'other profile columns stay locked');
select tests.ok(tests.throws($$ update public.profiles set is_bot = true $$), 'is_bot stays locked');
select tests.ok(tests.throws(format($$ update public.profiles set avatar_url = %L where id = %L $$, :'base' || :'ben' || '/b.png', :'ava')),
  'cannot point avatar_url at someone else''s folder');
select tests.ok(tests.throws(format($$ update public.profiles set avatar_url = 'https://tracker.example/pixel.png' where id = %L $$, :'ava')),
  'cannot point avatar_url at another site');
select tests.ok(tests.throws(format($$ update public.profiles set avatar_url = %L where id = %L $$, :'base' || :'ava' || '/../x.png', :'ava')),
  'no path tricks in avatar_url');

-- ava removes her photo
delete from storage.objects where name = :'ava' || '/one.png';
update public.profiles set avatar_url = null where id = :'ava';

reset role;
select tests.ok((select avatar_url from public.profiles where id = :'ben') is null, 'cannot set someone else''s avatar_url');
select tests.ok((select avatar_url from public.profiles where id = :'ava') is null, 'remove clears avatar_url');
select tests.ok((select count(*) from storage.objects where name = :'ava' || '/one.png') = 0, 'remove deletes the file');
select tests.ok((select avatar_url from public.profiles where id = '00000000-0000-4000-8000-00000000c7a1') = '/brand/ctrlroom-icon-192.png',
  'bots keep their icons');
select tests.ok(not has_function_privilege('authenticated', 'public.profiles_avatar_guard()', 'execute'), 'guard not callable');

rollback;
\echo all avatar tests passed
