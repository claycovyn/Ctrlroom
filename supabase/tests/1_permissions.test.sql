-- Permission + behaviour tests for 0001_init.sql. Run with `npm run db:test`.
\set QUIET on
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"username":"alice","display_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{"username":"bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'mallory@example.com', '{"username":"Mal lory!!"}'),
  ('00000000-0000-0000-0000-00000000000e', 'bob@other.com', '{"username":"bob"}');

select tests.ok((select count(*) from public.profiles where not is_bot) = 5, 'profile per signup');
select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 'carol', 'username from email');
select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-00000000000d') = 'mallory', 'username sanitised');
select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-00000000000e') ~ '^bob[0-9]{4}$', 'username collision gets a suffix');

-- Profiles are public by default since 0020. The people here have turned their public profile off, so these tests
-- keep checking who can see a hidden profile (the rules from before 0020).
update public.profiles set public_profile = false where not is_bot;
set role authenticated;

-- ── alice creates a community
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_community('OpenCtrl', 'openctrl', 'The collective', '⚡');
select tests.ok((select count(*) from public.rooms) = 3, 'default rooms');
select tests.ok(public.my_role((select id from public.communities where slug = 'openctrl')) = 'owner', 'creator is owner');
select tests.throws($$ select public.create_community('Bad', 'Bad Slug!') $$) as bad_slug \gset
select tests.ok(:'bad_slug'::boolean, 'slug validated');
insert into public.invites (community_id, created_by)
  select id, '00000000-0000-0000-0000-00000000000a' from public.communities where slug = 'openctrl'
  returning code as invite \gset
insert into public.invites (community_id, created_by, max_uses)
  select id, '00000000-0000-0000-0000-00000000000a', 1 from public.communities where slug = 'openctrl'
  returning code as single_invite \gset
insert into public.messages (room_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000a', 'Welcome! Read the board.' from public.rooms where slug = 'announcements'
  returning id as announcement \gset
select id as general, community_id as community from public.rooms where slug = 'general' \gset

-- ── bob is not a member yet: sees nothing
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.ok((select count(*) from public.communities) = 0, 'private community hidden from non-members');
select tests.ok((select count(*) from public.rooms) = 0, 'rooms hidden from non-members');
select tests.ok((select count(*) from public.messages) = 0, 'messages hidden from non-members');
select tests.ok((select count(*) from public.invites) = 0, 'invites hidden from non-members');
select tests.ok(not public.can_use_topic('room:' || :'announcement'), 'no realtime for non-members');
select tests.ok((select count(*) from public.profiles where not is_bot) = 1, 'only own profile visible before joining');

-- ── bob joins with the invite
select tests.ok(public.join_with_invite(:'invite') = 'openctrl', 'join returns slug');
select tests.ok(public.my_role((select id from public.communities where slug = 'openctrl')) = 'member', 'bob is member');
select tests.ok((select count(*) from public.rooms) = 3, 'member sees rooms');
select tests.ok((select count(*) from public.profiles where not is_bot) = 2, 'member sees co-members');
select tests.ok((select count(*) from public.invites) = 0, 'members cannot list invites');
select tests.ok(public.can_use_topic('room:' || (select id from public.rooms where slug = 'general')), 'member gets realtime');
select tests.ok(not public.can_use_topic('user:00000000-0000-0000-0000-00000000000a'), 'cannot listen to someone else''s pings');
select tests.ok(public.can_use_topic('user:00000000-0000-0000-0000-00000000000b'), 'can listen to own pings');
select tests.ok(not public.can_use_topic('room:not-a-uuid'), 'bad topic refused');

-- announcement room: members can't start posts but can reply
select tests.ok(tests.throws(format($$ insert into public.messages (room_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000b', 'hi' from public.rooms where slug = 'announcements' $$)), 'members cannot post in announcements');
insert into public.messages (room_id, author_id, body, parent_id)
  select id, '00000000-0000-0000-0000-00000000000b', 'Thanks!', :'announcement' from public.rooms where slug = 'announcements';

-- general: post, spoofing ignored, mentions
insert into public.messages (room_id, community_id, author_id, body, reply_count)
  select r.id, gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'hey @alice and @carol, plan for friday?', 999
  from public.rooms r where r.slug = 'general'
  returning id as bob_msg \gset
select tests.ok((select reply_count = 0 and community_id = (select id from public.communities where slug = 'openctrl')
  from public.messages where id = :'bob_msg'), 'client counters/community ignored');
select tests.ok(tests.throws(format($$ insert into public.messages (room_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000a', 'impersonation' from public.rooms where slug = 'general' $$)), 'cannot post as someone else');
select tests.ok(tests.throws($$ update public.messages set reply_count = 50 $$), 'cannot write counters');
update public.messages set body = 'hey @alice and @carol, plan for saturday?' where id = :'bob_msg';
select tests.ok((select edited_at is not null from public.messages where id = :'bob_msg'), 'edit stamps edited_at');
update public.messages set body = 'hacked' where id = :'announcement';
select tests.ok((select body from public.messages where id = :'announcement') = 'Welcome! Read the board.', 'cannot edit others');
select tests.ok(tests.throws(format('select public.delete_message(%L)', :'announcement')), 'member cannot delete owner message');
select tests.ok(tests.throws($$ select public.emit('room:x', 'message', '{}') $$), 'emit is internal');

-- ── carol (not a member) is mentioned: no mention row; alice is
reset role;
select tests.ok((select count(*) from public.mentions where message_id = :'bob_msg') = 1, 'only members get mentioned');
select tests.ok((select user_id from public.mentions where message_id = :'bob_msg') = '00000000-0000-0000-0000-00000000000a', 'alice mentioned');
select tests.ok((select reply_count from public.messages where id = :'announcement') = 1, 'reply count bumped');
select tests.ok(exists (select 1 from public.mentions where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'reply'), 'reply pings the thread starter');
select tests.ok(exists (select 1 from realtime.messages where topic = 'room:' || (select room_id from public.messages where id = :'bob_msg') and event = 'message'), 'room broadcast');
select tests.ok(exists (select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-00000000000a' and event = 'mention'), 'mention broadcast');
select tests.ok(not exists (select 1 from realtime.messages where payload ? 'search'), 'search vector never broadcast');
set role authenticated;

-- ── alice reads her pings, replies, resolves the thread
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.ok((select mentions from public.my_unreads((select id from public.communities where slug = 'openctrl'))
  where room_id = (select room_id from public.messages where id = :'bob_msg')) = 1, 'unread mention counted');
select tests.ok((public.catch_up((select room_id from public.messages where id = :'bob_msg')) ->> 'new_messages')::int = 1, 'catch up counts new');
insert into public.messages (room_id, author_id, body, parent_id)
  select room_id, '00000000-0000-0000-0000-00000000000a', 'Saturday works', id from public.messages where id = :'bob_msg';
select tests.ok(tests.throws(format($$ insert into public.messages (room_id, author_id, body, parent_id)
  select room_id, '00000000-0000-0000-0000-00000000000a', 'nested', id from public.messages where parent_id = %L $$, :'bob_msg')), 'threads are one level');
select public.resolve_thread(:'bob_msg', 'Meetup is Saturday 2pm');
select tests.ok((select outcome from public.messages where id = :'bob_msg') = 'Meetup is Saturday 2pm', 'outcome stored');
select tests.ok((select count(*) from public.board_items where kind = 'decision') = 1, 'outcome pinned to board');
select public.mark_read((select room_id from public.messages where id = :'bob_msg'));
select tests.ok((select unread + mentions from public.my_unreads((select id from public.communities where slug = 'openctrl'))
  where room_id = (select room_id from public.messages where id = :'bob_msg')) = 0, 'mark read clears');
select tests.ok((select count(*) from public.search_messages((select id from public.communities where slug = 'openctrl'), 'saturday')) = 2, 'search');

select public.set_room_notify(:'general', 'all');
select tests.ok((select notify from public.my_unreads(:'community') where room_id = :'general') = 'all', 'notify level saved');
select tests.ok(tests.throws(format('select public.set_room_notify(%L, %L)', :'general', 'loud')), 'notify level validated');

-- reactions
insert into public.reactions (message_id, user_id, emoji) values (:'bob_msg', '00000000-0000-0000-0000-00000000000a', '🔥');
select tests.ok(tests.throws(format($$ insert into public.reactions (message_id, user_id, emoji) values (%L, '00000000-0000-0000-0000-00000000000b', '👎') $$, :'bob_msg')), 'cannot react as someone else');

-- ── roles
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.throws($$ select public.set_member_role((select id from public.communities where slug = 'openctrl'), '00000000-0000-0000-0000-00000000000b', 'admin') $$), 'cannot promote self');
select tests.ok(tests.throws($$ insert into public.rooms (community_id, slug, name) select id, 'mine', 'mine' from public.communities $$), 'members cannot create rooms');
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.set_member_role((select id from public.communities where slug = 'openctrl'), '00000000-0000-0000-0000-00000000000b', 'mod');
insert into public.rooms (community_id, slug, name, kind) select id, 'studio', 'studio', 'voice' from public.communities where slug = 'openctrl';

-- carol joins via the single-use invite; mallory can't reuse it
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.join_with_invite(:'single_invite');
insert into public.messages (room_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000c', 'spam spam' from public.rooms where slug = 'general'
  returning id as spam \gset
select tests.login('00000000-0000-0000-0000-00000000000d');
select tests.ok(tests.throws(format('select public.join_with_invite(%L)', :'single_invite')), 'single-use invite used up');
select tests.ok(tests.throws(format($$ insert into public.messages (room_id, author_id, body)
  values (%L, '00000000-0000-0000-0000-00000000000d', 'x') $$, :'general')), 'non-member cannot post');
select tests.ok(tests.throws(format($$ insert into public.reactions (message_id, user_id, emoji)
  values (%L, '00000000-0000-0000-0000-00000000000d', 'x') $$, :'bob_msg')), 'non-member cannot react');
select tests.ok((select count(*) from public.my_unreads(:'community')) = 0, 'non-member gets no unreads');
select tests.ok(public.catch_up(:'general') is null, 'non-member gets no catch-up');
select tests.ok(tests.throws(format('select public.set_room_notify(%L, %L)', :'general', 'all')), 'non-member cannot set notify');
select tests.ok((select count(*) from public.search_messages(:'community', 'saturday')) = 0, 'non-member search empty');

-- bob (mod) removes carol's spam and bans her; can't touch alice
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.delete_message(:'spam');
select tests.ok((select deleted_at is not null and body = '' from public.messages where id = :'spam'), 'mod deletes spam');
select public.remove_member((select id from public.communities where slug = 'openctrl'), '00000000-0000-0000-0000-00000000000c', true, 'spam');
select tests.ok(tests.throws($$ select public.remove_member((select id from public.communities where slug = 'openctrl'), '00000000-0000-0000-0000-00000000000a') $$), 'mod cannot remove owner');
select tests.ok(tests.throws($$ select public.set_member_role((select id from public.communities where slug = 'openctrl'), '00000000-0000-0000-0000-00000000000a', 'member') $$), 'mod cannot demote owner');
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.throws(format('select public.join_with_invite(%L)', :'invite')), 'banned user cannot rejoin');
select tests.ok((select count(*) from public.messages) = 0, 'removed member loses access');

-- owner can't just leave
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.ok(tests.throws($$ select public.leave_community((select id from public.communities where slug = 'openctrl')) $$), 'owner cannot leave');

-- anon can do nothing
reset role;
set role anon;
select tests.ok(tests.throws($$ select public.create_community('x', 'xyz') $$), 'anon cannot call functions');
reset role;
\echo all permission tests passed
