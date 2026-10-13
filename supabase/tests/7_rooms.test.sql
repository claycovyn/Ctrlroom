-- Room tests for 0007_rooms.sql: editing rooms (owner/admin only, slug locked), descriptions, personal pins.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-00000000000a', 'own7@example.com', '{"username":"own7"}'),
  ('70000000-0000-0000-0000-00000000000b', 'adm7@example.com', '{"username":"adm7"}'),
  ('70000000-0000-0000-0000-00000000000c', 'mod7@example.com', '{"username":"mod7"}'),
  ('70000000-0000-0000-0000-00000000000d', 'mem7@example.com', '{"username":"mem7"}'),
  ('70000000-0000-0000-0000-00000000000e', 'out7@example.com', '{"username":"out7"}');
\set own 70000000-0000-0000-0000-00000000000a
\set adm 70000000-0000-0000-0000-00000000000b
\set mod 70000000-0000-0000-0000-00000000000c
\set mem 70000000-0000-0000-0000-00000000000d
\set out 70000000-0000-0000-0000-00000000000e
\set c 71000000-0000-0000-0000-000000000001
\set other 71000000-0000-0000-0000-000000000002
\set general 72000000-0000-0000-0000-000000000001
\set news 72000000-0000-0000-0000-000000000002
\set lounge 72000000-0000-0000-0000-000000000003
\set secret 72000000-0000-0000-0000-000000000004

insert into public.communities (id, slug, name, owner_id, is_public) values
  (:'c', 'rooms-test', 'Rooms test', :'own', true),
  (:'other', 'rooms-other', 'Other rooms', :'out', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'adm', 'admin'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member'),
  (:'other', :'out', 'owner');
insert into public.rooms (id, community_id, slug, name, topic, kind, post_min_role, position) values
  (:'general', :'c', 'general', 'general', 'Say hi.', 'text', 'member', 0),
  (:'news', :'c', 'news', 'news', '', 'text', 'mod', 1),
  (:'lounge', :'c', 'lounge', 'lounge', '', 'voice', 'member', 2),
  (:'secret', :'other', 'secret', 'secret', '', 'text', 'member', 0);

select tests.ok((select description = '' from public.rooms where id = :'general'), 'rooms start with an empty description');

set role authenticated;

-- ── editing: admin and owner change name, topic, description, kind, who can post, order
select tests.login(:'adm');
update public.rooms set name = 'General chat', topic = 'Say hello.', description = 'Anything goes. Be kind.',
  post_min_role = 'mod', position = 5, kind = 'voice' where id = :'general';
reset role;
select tests.ok((select name = 'General chat' and topic = 'Say hello.' and description = 'Anything goes. Be kind.'
                   and post_min_role = 'mod' and position = 5 and kind = 'voice' and slug = 'general'
                 from public.rooms where id = :'general'), 'admin edits name, topic, description, who posts, order and kind');
set role authenticated;
select tests.login(:'own');
update public.rooms set description = 'Owner note', post_min_role = 'member', position = 0, kind = 'text' where id = :'general';
reset role;
select tests.ok((select description = 'Owner note' and post_min_role = 'member' and position = 0 and kind = 'text'
                 from public.rooms where id = :'general'), 'owner edits rooms');
set role authenticated;

select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.rooms set slug = 'renamed' where id = %L $$, :'general')), 'slug stays locked');
select tests.ok(tests.throws(format($$ update public.rooms set community_id = %L where id = %L $$, :'other', :'general')),
  'community_id stays locked');
select tests.ok(tests.throws(format($$ update public.rooms set description = repeat('x', 1001) where id = %L $$, :'general')),
  'description is at most 1000 characters');
update public.rooms set description = repeat('x', 1000) where id = :'general';
reset role;
select tests.ok((select char_length(description) = 1000 from public.rooms where id = :'general'), '1000 characters is fine');
set role authenticated;
select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.rooms set post_min_role = 'nobody' where id = %L $$, :'general')),
  'post_min_role must be a role');
select tests.ok(tests.throws(format($$ update public.rooms set kind = 'video' where id = %L $$, :'general')), 'kind must be text or voice');
-- admins of one community can't edit another's rooms (no error, nothing happens)
update public.rooms set description = 'hijack' where id = :'secret';

-- mods (as in 0001), members and outsiders can't edit rooms (no error, nothing happens)
select tests.login(:'mod');
update public.rooms set name = 'mod-was-here', description = 'mod', position = 9 where id = :'general';
select tests.login(:'mem');
update public.rooms set name = 'mem-was-here', description = 'mem', post_min_role = 'member' where id = :'news';
select tests.login(:'out');
update public.rooms set description = 'out' where id = :'general';
reset role;
select tests.ok((select name = 'General chat' and char_length(description) = 1000 and position = 0 from public.rooms where id = :'general'),
  'mods and outsiders cannot edit rooms');
select tests.ok((select name = 'news' and post_min_role = 'mod' and description = '' from public.rooms where id = :'news'),
  'members cannot edit rooms');
select tests.ok((select description = '' from public.rooms where id = :'secret'), 'admins cannot edit another community''s rooms');
set role authenticated;

-- members see the description
select tests.login(:'mem');
select tests.ok((select char_length(description) = 1000 from public.rooms where id = :'general'), 'members read the description');

-- ── pins: your own, rooms you can see
select tests.login(:'mem');
insert into public.room_pins (user_id, room_id) values (:'mem', :'news'), (:'mem', :'lounge');
select tests.ok((select count(*) from public.room_pins) = 2, 'member pins rooms they can see');
select tests.ok(tests.throws(format($$ insert into public.room_pins (user_id, room_id) values (%L, %L) $$, :'mem', :'secret')),
  'cannot pin a room you cannot see');
select tests.ok(tests.throws(format($$ insert into public.room_pins (user_id, room_id) values (%L, %L) $$, :'mod', :'general')),
  'cannot pin for someone else');
select tests.ok(tests.throws(format($$ insert into public.room_pins (user_id, room_id) values (%L, %L) $$, :'mem', :'news')),
  'a room is pinned once');
select tests.ok(tests.throws(format($$ update public.room_pins set created_at = now() - interval '1 day' where room_id = %L $$, :'news')),
  'pins cannot be updated');

select tests.login(:'mod');
insert into public.room_pins (user_id, room_id) values (:'mod', :'general');
select tests.ok((select count(*) from public.room_pins) = 1, 'you see only your own pins');
select tests.ok(not exists (select 1 from public.room_pins where user_id = :'mem'), 'cannot read others'' pins');
delete from public.room_pins where user_id = :'mem';
select tests.login(:'out');
select tests.ok(tests.throws(format($$ insert into public.room_pins (user_id, room_id) values (%L, %L) $$, :'out', :'general')),
  'non-members cannot pin');
delete from public.room_pins;
reset role;
select tests.ok((select count(*) from public.room_pins where user_id = :'mem') = 2, 'cannot delete others'' pins');
set role authenticated;

select tests.login(:'mem');
delete from public.room_pins where room_id = :'lounge';
select tests.ok((select count(*) from public.room_pins) = 1, 'unpin your own');

-- signed out: nothing
reset role;
set role anon;
select tests.ok(tests.throws($$ select * from public.room_pins $$), 'signed-out cannot read pins');
reset role;

-- ── 20 pins per person per community
insert into public.rooms (community_id, slug, name, position)
  select :'c', 'extra-' || g, 'extra-' || g, 10 + g from generate_series(1, 25) g;
set role authenticated;
select tests.login(:'adm');
insert into public.room_pins (user_id, room_id)
  select :'adm', id from public.rooms where community_id = :'c' and slug like 'extra-%' order by position limit 20;
select tests.ok(tests.throws(format($$ insert into public.room_pins (user_id, room_id) values (%L, %L) $$, :'adm', :'general')),
  'at most 20 pins per community');
select tests.login(:'mem');
insert into public.room_pins (user_id, room_id) values (:'mem', :'general');
select tests.ok((select count(*) from public.room_pins) = 2, 'the limit is per person');

-- ── cascade: deleting a room clears its pins; leaving clears yours
select tests.login(:'adm');
delete from public.rooms where id = :'news';
reset role;
select tests.ok(not exists (select 1 from public.room_pins where room_id = :'news'), 'deleting a room clears its pins');
select tests.ok((select count(*) from public.room_pins where user_id = :'mem') = 1, 'other pins stay');
set role authenticated;
select tests.login(:'mem');
select public.leave_community(:'c');
reset role;
select tests.ok(not exists (select 1 from public.room_pins where user_id = :'mem'), 'leaving a community clears your pins there');
select tests.ok((select count(*) from public.room_pins where user_id = :'adm') = 20, 'others keep theirs');

-- ── sections: owners and admins manage them, everyone in the community reads them
\set sec 73000000-0000-0000-0000-000000000001
\set sec2 73000000-0000-0000-0000-000000000002
\set foreign 73000000-0000-0000-0000-000000000009
insert into public.room_sections (id, community_id, name, position) values (:'foreign', :'other', 'Theirs', 0);
set role authenticated;
select tests.login(:'adm');
insert into public.room_sections (id, community_id, name, position) values (:'sec', :'c', 'Projects', 0);
update public.room_sections set name = 'Work', position = 3 where id = :'sec';
update public.rooms set section_id = :'sec', position = 7 where id = :'general';
select tests.login(:'own');
insert into public.room_sections (id, community_id, name, position) values (:'sec2', :'c', 'Social', 1);
update public.rooms set section_id = :'sec2' where id = :'lounge';
reset role;
select tests.ok((select name = 'Work' and position = 3 from public.room_sections where id = :'sec'), 'admin creates, renames and reorders a section');
select tests.ok((select section_id = :'sec' and position = 7 from public.rooms where id = :'general')
                and (select section_id = :'sec2' from public.rooms where id = :'lounge'), 'admin and owner move rooms into sections');
set role authenticated;

select tests.login(:'adm');
select tests.ok(tests.throws(format($$ update public.rooms set section_id = %L where id = %L $$, :'foreign', :'general')),
  'cannot put a room in another community''s section');
select tests.ok(tests.throws(format($$ insert into public.rooms (community_id, slug, name, section_id) values (%L, 'sneaky', 'sneaky', %L) $$, :'c', :'foreign')),
  'cannot create a room in another community''s section');
select tests.ok(tests.throws(format($$ insert into public.room_sections (community_id, name) values (%L, 'Mine') $$, :'other')),
  'cannot add sections to another community');
select tests.ok(tests.throws(format($$ insert into public.room_sections (community_id, name) values (%L, '') $$, :'c')),
  'section name is 1 to 48 characters');
select tests.ok(tests.throws(format($$ update public.room_sections set name = repeat('x', 49) where id = %L $$, :'sec')),
  'section name at most 48 characters');
select tests.ok(tests.throws(format($$ update public.room_sections set community_id = %L where id = %L $$, :'other', :'sec')),
  'section community stays locked');

select tests.login(:'mod');
select tests.ok((select count(*) from public.room_sections) = 2, 'mods read the sections');
select tests.ok(tests.throws(format($$ insert into public.room_sections (community_id, name) values (%L, 'Mod stuff') $$, :'c')),
  'mods cannot add sections');
update public.room_sections set name = 'mod-was-here' where id = :'sec';
delete from public.room_sections where id = :'sec2';
update public.rooms set section_id = null where id = :'general';
select tests.login(:'out');
select tests.ok((select count(*) from public.room_sections) = 1, 'non-members see only their own community''s sections');
update public.room_sections set name = 'out' where id = :'sec';
reset role;
select tests.ok((select name = 'Work' from public.room_sections where id = :'sec')
                and exists (select 1 from public.room_sections where id = :'sec2')
                and (select section_id = :'sec' from public.rooms where id = :'general'),
  'mods and outsiders cannot change sections or move rooms');
set role authenticated;

-- deleting a section keeps its rooms; they fall back to no section
select tests.login(:'adm');
delete from public.room_sections where id = :'sec';
reset role;
select tests.ok((select section_id is null from public.rooms where id = :'general'), 'deleting a section keeps its rooms, with no section');
select tests.ok((select section_id = :'sec2' from public.rooms where id = :'lounge'), 'other sections keep their rooms');

-- ── privileges
select tests.ok(not has_function_privilege('authenticated', 'public.room_pins_limit()', 'execute')
                and not has_function_privilege('authenticated', 'public.room_pins_on_leave()', 'execute')
                and not has_function_privilege('authenticated', 'public.rooms_section_guard()', 'execute')
                and not has_function_privilege('authenticated', 'public.room_sections_broadcast()', 'execute'),
  'triggers not callable');
select tests.ok(not has_table_privilege('anon', 'public.room_sections', 'select')
                and not has_column_privilege('authenticated', 'public.room_sections', 'community_id', 'update'),
  'sections: no anon access, community locked');
select tests.ok(not has_table_privilege('anon', 'public.room_pins', 'select')
                and not has_table_privilege('authenticated', 'public.room_pins', 'update'),
  'pins: no anon access, no updates');
select tests.ok(has_column_privilege('authenticated', 'public.rooms', 'description', 'update')
                and has_column_privilege('authenticated', 'public.rooms', 'position', 'update')
                and has_column_privilege('authenticated', 'public.rooms', 'section_id', 'update')
                and not has_column_privilege('authenticated', 'public.rooms', 'slug', 'update')
                and not has_column_privilege('authenticated', 'public.rooms', 'community_id', 'update'),
  'room columns: description opened, slug and community locked');

rollback;
\echo all room tests passed
