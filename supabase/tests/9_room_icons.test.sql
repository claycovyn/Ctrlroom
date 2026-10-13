-- Room icon tests for 0009_room_icons.sql: owners/admins set rooms.icon, mods/members can't, bad ids are rejected.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-00000000000a', 'own9@example.com', '{"username":"own9"}'),
  ('90000000-0000-0000-0000-00000000000b', 'adm9@example.com', '{"username":"adm9"}'),
  ('90000000-0000-0000-0000-00000000000c', 'mod9@example.com', '{"username":"mod9"}'),
  ('90000000-0000-0000-0000-00000000000d', 'mem9@example.com', '{"username":"mem9"}'),
  ('90000000-0000-0000-0000-00000000000e', 'out9@example.com', '{"username":"out9"}');
\set own 90000000-0000-0000-0000-00000000000a
\set adm 90000000-0000-0000-0000-00000000000b
\set mod 90000000-0000-0000-0000-00000000000c
\set mem 90000000-0000-0000-0000-00000000000d
\set out 90000000-0000-0000-0000-00000000000e
\set c 91000000-0000-0000-0000-000000000001
\set general 92000000-0000-0000-0000-000000000001
\set lounge 92000000-0000-0000-0000-000000000002

insert into public.communities (id, slug, name, owner_id, is_public) values (:'c', 'icons-test', 'Icons test', :'own', true);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'adm', 'admin'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member');
insert into public.rooms (id, community_id, slug, name, kind, position) values
  (:'general', :'c', 'general', 'general', 'text', 0),
  (:'lounge', :'c', 'lounge', 'lounge', 'voice', 1);

select tests.ok((select icon is null from public.rooms where id = :'general'), 'rooms start with no icon');

set role authenticated;

-- ── owners and admins set, change and clear the icon
select tests.login(:'adm');
update public.rooms set icon = 'announcements' where id = :'general';
reset role;
select tests.ok((select icon = 'announcements' from public.rooms where id = :'general'), 'admin sets an icon');
set role authenticated;
select tests.login(:'own');
update public.rooms set icon = 'lounge' where id = :'lounge';
update public.rooms set icon = null where id = :'general';
reset role;
select tests.ok((select icon = 'lounge' from public.rooms where id = :'lounge'), 'owner sets an icon');
select tests.ok((select icon is null from public.rooms where id = :'general'), 'owner clears an icon (back to the default)');
set role authenticated;

-- an admin can create a room with an icon
select tests.login(:'adm');
insert into public.rooms (community_id, slug, name, kind, position, icon) values (:'c', 'memes', 'memes', 'text', 2, 'memes');
reset role;
select tests.ok((select icon = 'memes' from public.rooms where community_id = :'c' and slug = 'memes'), 'admin creates a room with an icon');
set role authenticated;

-- ── bad values are rejected (the app knows the real list; the DB checks the shape)
select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.rooms set icon = 'Announcements' where id = %L $$, :'general')), 'uppercase is rejected');
select tests.ok(tests.throws(format($$ update public.rooms set icon = '' where id = %L $$, :'general')), 'empty string is rejected');
select tests.ok(tests.throws(format($$ update public.rooms set icon = repeat('a', 33) where id = %L $$, :'general')), 'over 32 characters is rejected');
select tests.ok(tests.throws(format($$ update public.rooms set icon = 'https://example.com/x.png' where id = %L $$, :'general')), 'a URL is rejected');
select tests.ok(tests.throws(format($$ update public.rooms set icon = '<svg>' where id = %L $$, :'general')), 'markup is rejected');
select tests.ok(tests.throws(format($$ update public.rooms set icon = 'dev ops' where id = %L $$, :'general')), 'spaces are rejected');
update public.rooms set icon = repeat('a', 32) where id = :'general';
reset role;
select tests.ok((select icon = repeat('a', 32) from public.rooms where id = :'general'), '32 characters is fine (unknown ids show the default)');
set role authenticated;

-- ── mods, members and outsiders can't set icons (no error, nothing happens)
select tests.login(:'mod');
update public.rooms set icon = 'gaming' where id = :'lounge';
select tests.login(:'mem');
update public.rooms set icon = 'memes' where id = :'lounge';
select tests.login(:'out');
update public.rooms set icon = 'help' where id = :'lounge';
reset role;
select tests.ok((select icon = 'lounge' from public.rooms where id = :'lounge'), 'mods, members and outsiders cannot change the icon');
set role authenticated;
select tests.login(:'mod');
select tests.ok(tests.throws(format($$ insert into public.rooms (community_id, slug, name, kind, icon) values (%L, 'modroom', 'modroom', 'text', 'dev') $$, :'c')),
  'mods cannot create rooms with an icon');

-- members read the icon
select tests.login(:'mem');
select tests.ok((select icon = 'lounge' from public.rooms where id = :'lounge'), 'members read the icon');

-- the column grant still locks slug and community_id
select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.rooms set slug = 'renamed' where id = %L $$, :'lounge')), 'slug stays locked');

reset role;
rollback;
