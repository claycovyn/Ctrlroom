-- Direct message tests for 0011_dms.sql: who can DM you, requests, blocks, groups, leaving, the flood guard, edits,
-- reports, search, realtime topics and function grants.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-00000000000a', 'alice11@example.com', '{"username":"alice11","display_name":"Alice"}'),
  ('b1000000-0000-0000-0000-00000000000b', 'bob11@example.com', '{"username":"bob11","display_name":"Bob"}'),
  ('b1000000-0000-0000-0000-00000000000c', 'carol11@example.com', '{"username":"carol11","display_name":"Carol"}'),
  ('b1000000-0000-0000-0000-00000000000d', 'dave11@example.com', '{"username":"dave11","display_name":"Dave"}'),
  ('b1000000-0000-0000-0000-00000000000e', 'eve11@example.com', '{"username":"eve11","display_name":"Eve"}'),
  ('b1000000-0000-0000-0000-000000000011', 'hank11@example.com', '{"username":"hank11"}'),
  ('b1000000-0000-0000-0000-000000000012', 'ivy11@example.com', '{"username":"ivy11"}'),
  ('b1000000-0000-0000-0000-000000000013', 'jo11@example.com', '{"username":"jo11"}'),
  ('b1000000-0000-0000-0000-000000000014', 'kim11@example.com', '{"username":"kim11"}');
insert into auth.users (id, email, raw_user_meta_data)
  select ('b1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'f' || n || '_11@example.com',
         jsonb_build_object('username', 'f' || n || '_11')
  from generate_series(1, 10) as n;
\set a b1000000-0000-0000-0000-00000000000a
\set b b1000000-0000-0000-0000-00000000000b
\set c b1000000-0000-0000-0000-00000000000c
\set d b1000000-0000-0000-0000-00000000000d
\set e b1000000-0000-0000-0000-00000000000e
\set h b1000000-0000-0000-0000-000000000011
\set i b1000000-0000-0000-0000-000000000012
\set j b1000000-0000-0000-0000-000000000013
\set k b1000000-0000-0000-0000-000000000014
\set f1 b1000000-0000-0000-0000-000000000101
\set f9 b1000000-0000-0000-0000-000000000109
\set f10 b1000000-0000-0000-0000-000000000110
\set c1 b2000000-0000-0000-0000-000000000001
\set c2 b2000000-0000-0000-0000-000000000002

-- c1: Alice, Bob, Dave, Hank, Ivy, Jo, Kim and ten more. c2: Carol and Eve. Alice shares nothing with Carol or Eve.
insert into public.communities (id, slug, name, owner_id, is_public) values
  (:'c1', 'dm-test-one', 'DM test one', :'a', false),
  (:'c2', 'dm-test-two', 'DM test two', :'c', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c1', :'a', 'owner'), (:'c1', :'b', 'member'), (:'c1', :'d', 'member'), (:'c1', :'h', 'member'),
  (:'c1', :'i', 'member'), (:'c1', :'j', 'member'), (:'c1', :'k', 'member'),
  (:'c2', :'c', 'owner'), (:'c2', :'e', 'member');
insert into public.community_members (community_id, user_id)
  select :'c1', ('b1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 10) as n;

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
create function tests.id(p text) returns uuid language sql stable as $$ select v from t_ids where k = p $$;
create function tests.say(p_conv uuid, p_body text) returns void language sql as $$
  insert into public.dm_messages (conversation_id, author_id, body) values (p_conv, auth.uid(), p_body)
$$;
create function tests.say_many(p_conv uuid, n int) returns void language plpgsql as $$
begin
  for x in 1..n loop
    insert into public.dm_messages (conversation_id, author_id, body) values (p_conv, auth.uid(), 'spam ' || x);
  end loop;
end $$;
create function tests.visible(p_conv uuid) returns int language sql stable as $$
  select count(*)::int from public.dm_messages where conversation_id = p_conv
$$;
grant execute on function tests.id(text), tests.say(uuid, text), tests.say_many(uuid, int), tests.visible(uuid) to authenticated, anon;

set role authenticated;

-- ── the default: people you share a community with
select tests.login(:'a');
insert into t_ids values ('ab', public.start_dm(array[:'b']::uuid[], 'hi bob'));
select tests.ok(tests.id('ab') is not null, 'Alice messages Bob (they share a community)');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'hi carol') $$, :'c')),
  'Alice cannot message Carol: no shared community and Carol is on the default');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], '   ') $$, :'b')), 'an empty message is refused');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'me') $$, :'a')), 'you cannot message only yourself');
select tests.ok(tests.throws($$ select public.start_dm(array['00000000-0000-4000-8000-00000000c7a1']::uuid[], 'hi bot') $$),
  'nobody can DM the AI helpers');
reset role;
select tests.ok((select status = 'request' from public.dm_members where conversation_id = tests.id('ab') and user_id = :'b'),
  'Bob has never talked with Alice, so it lands in his Requests');
select tests.ok((select status = 'active' from public.dm_members where conversation_id = tests.id('ab') and user_id = :'a'),
  'the sender is active');
set role authenticated;

-- ── "Anyone on Ctrl Room" and "Nobody"
select tests.login(:'c');
select public.set_who_can_dm('anyone');
select tests.ok((select who_can_dm = 'anyone' from public.dm_settings where user_id = :'c'), 'Carol reads her own setting');
select tests.ok(tests.throws($$ select public.set_who_can_dm('everyone') $$), 'only the three settings exist');
select tests.login(:'a');
select tests.ok((select count(*) = 0 from public.dm_settings), 'Alice cannot read Carol''s setting');
insert into t_ids values ('ac', public.start_dm(array[:'c']::uuid[], 'hi carol'));
select tests.ok(tests.id('ac') is not null, 'with "anyone", Alice can message Carol');
select tests.login(:'d');
select public.set_who_can_dm('nobody');
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'hi dave') $$, :'d')),
  'with "nobody", even a shared community is not enough');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L, %L]::uuid[], 'group with dave') $$, :'b', :'d')),
  '... and nobody can put Dave in a group either');
select tests.login(:'d');
select public.set_who_can_dm('shared_community');
select tests.login(:'a');
insert into t_ids values ('ad', public.start_dm(array[:'d']::uuid[], 'hi dave'));
select tests.ok(tests.id('ad') is not null, 'back on the default, Alice can message Dave');

-- ── requests: the recipient reads but can't post or react until they accept
select tests.login(:'b');
select tests.ok(tests.visible(tests.id('ab')) = 1, 'Bob reads the request');
select tests.ok((select count(*) = 1 from public.dm_conversations where id = tests.id('ab')), 'Bob sees the conversation');
select tests.ok((select count(*) = 2 from public.dm_members where conversation_id = tests.id('ab')), 'Bob sees who is in it');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'reply before accepting') $$, tests.id('ab'))), 'Bob cannot post before accepting');
select tests.ok(tests.throws(format($$ insert into public.dm_reactions (message_id, user_id, emoji)
  select id, %L, '👍' from public.dm_messages where conversation_id = %L $$, :'b', tests.id('ab'))), 'Bob cannot react before accepting');
select tests.ok(tests.throws(format($$ select muted from public.dm_members where conversation_id = %L $$, tests.id('ab'))),
  'other people''s mute, read and ignore state is not readable');
select tests.ok((select status = 'request' and unread = 1 from public.my_dm_inbox() where id = tests.id('ab')), 'the inbox shows it as a request');
select public.accept_dm_request(tests.id('ab'));
select tests.ok(tests.throws(format($$ select public.accept_dm_request(%L) $$, tests.id('ab'))), 'there is nothing left to accept');
select tests.say(tests.id('ab'), 'hi alice');
select tests.ok(tests.visible(tests.id('ab')) = 2, 'after accepting, Bob posts');
select tests.ok((select status = 'active' from public.my_dm_inbox() where id = tests.id('ab')), 'and it moves to his chats');

-- ── start_dm reuses the pair's conversation, from either side
select tests.login(:'a');
select tests.ok(public.start_dm(array[:'b']::uuid[], 'again') = tests.id('ab'), 'Alice → Bob again: same conversation');
select tests.login(:'b');
select tests.ok(public.start_dm(array[:'a', :'a', :'b']::uuid[], 'yo') = tests.id('ab'), 'Bob → Alice (with duplicates and himself): same conversation');
reset role;
select tests.ok((select count(*) = 1 from public.dm_conversations where pair_key like '%' || :'a' || '%' and pair_key like '%' || :'b' || '%'),
  'one conversation per pair');
set role authenticated;

-- ── talked before: no request the next time
select tests.login(:'b');
insert into t_ids values ('group_ba', public.start_dm(array[:'a', :'h']::uuid[], 'a group', 'Planning'));
reset role;
select tests.ok((select status = 'active' from public.dm_members where conversation_id = tests.id('group_ba') and user_id = :'a'),
  'Alice already talks with Bob, so his group goes straight to her chats');
select tests.ok((select status = 'request' from public.dm_members where conversation_id = tests.id('group_ba') and user_id = :'h'),
  '... and lands in Hank''s Requests');
select tests.ok((select title = 'Planning' and is_group from public.dm_conversations where id = tests.id('group_ba')), 'groups can be named');
set role authenticated;

-- ── ignoring a request
select tests.login(:'c');
select tests.ok(tests.visible(tests.id('ac')) = 1, 'Carol reads Alice''s request');
select public.ignore_dm_request(tests.id('ac'));
select tests.ok((select status = 'request' and ignored from public.my_dm_inbox() where id = tests.id('ac')), 'ignored requests stay requests, marked ignored');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'still no') $$, tests.id('ac'))), 'ignoring does not let Carol post');
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select public.ignore_dm_request(%L) $$, tests.id('ab'))), 'only a request can be ignored');
select tests.say(tests.id('ac'), 'hello again');
reset role;
select tests.ok((select payload ->> 'ignored' = 'true' and payload ->> 'status' = 'request' from realtime.messages
                 where topic = 'user:' || :'c' and event = 'dm' order by id desc limit 1),
  'the event tells Carol''s app the request is ignored, so it stays quiet');
set role authenticated;

-- ── profiles: people in a conversation see each other, nobody else does
select tests.login(:'c');
select tests.ok((select count(*) = 1 from public.profiles where id = :'a'), 'Carol sees Alice''s profile through the DM');
select tests.login(:'e');
select tests.ok((select count(*) = 0 from public.profiles where id = :'a'), 'Eve does not');

-- ── non-members get nothing
select tests.login(:'e');
select tests.ok(tests.visible(tests.id('ab')) = 0, 'Eve cannot read Alice and Bob''s messages');
select tests.ok((select count(*) = 0 from public.dm_conversations where id = tests.id('ab')), 'or see the conversation');
select tests.ok((select count(*) = 0 from public.dm_members where conversation_id = tests.id('ab')), 'or who is in it');
select tests.ok((select count(*) = 0 from public.dm_reactions), 'or reactions');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'let me in') $$, tests.id('ab'))), 'Eve cannot post into it');
select tests.ok(tests.throws(format($$ select public.accept_dm_request(%L) $$, tests.id('ab'))), 'or accept for someone');
select tests.ok(tests.throws(format($$ select public.add_to_group(%L, array[%L]::uuid[]) $$, tests.id('group_ba'), :'e')), 'or add herself to a group');
select tests.ok(tests.throws(format($$ select public.rename_dm_group(%L, 'mine') $$, tests.id('group_ba'))), 'or rename it');
select tests.ok(tests.throws(format($$ select public.leave_dm(%L) $$, tests.id('group_ba'))), 'or leave it');
select tests.ok(tests.throws(format($$ select public.set_dm_muted(%L, true) $$, tests.id('ab'))), 'or mute it');
select tests.ok((select count(*) = 0 from public.my_dm_inbox()), 'Eve''s inbox is empty');
select public.mark_dm_read(tests.id('ab'));
reset role;
select tests.ok((select count(*) = 0 from public.dm_members where user_id = :'e'), 'mark_dm_read does nothing for outsiders');
set role authenticated;

-- ── edits and deletes: only your own
select tests.login(:'a');
insert into t_ids select 'alice_msg', id from public.dm_messages where conversation_id = tests.id('ab') and body = 'hi bob';
select tests.login(:'b');
update public.dm_messages set body = 'hacked' where id = tests.id('alice_msg');
reset role;
select tests.ok((select body = 'hi bob' and edited_at is null from public.dm_messages where id = tests.id('alice_msg')), 'Bob cannot edit Alice''s message');
set role authenticated;
select tests.ok(tests.throws(format($$ select public.delete_dm_message(%L) $$, tests.id('alice_msg'))), 'or delete it');
select tests.ok(tests.throws(format($$ update public.dm_messages set deleted_at = now() where id = %L $$, tests.id('alice_msg'))),
  'nobody writes deleted_at directly (column grant)');
select tests.login(:'a');
update public.dm_messages set body = 'hi bob!' where id = tests.id('alice_msg');
select tests.ok((select body = 'hi bob!' and edited_at is not null from public.dm_messages where id = tests.id('alice_msg')), 'Alice edits her own message');
select tests.ok(tests.throws(format($$ update public.dm_messages set author_id = %L where id = %L $$, :'b', tests.id('alice_msg'))),
  'the author cannot be changed');
insert into public.dm_reactions (message_id, user_id, emoji) values (tests.id('alice_msg'), :'a', '👍');
select tests.login(:'b');
insert into public.dm_reactions (message_id, user_id, emoji) values (tests.id('alice_msg'), :'b', '🔥');
select tests.ok((select count(*) = 2 from public.dm_reactions where message_id = tests.id('alice_msg')), 'active members react');
select tests.login(:'e');
select tests.ok((select count(*) = 0 from public.dm_reactions), 'outsiders see no reactions');
select tests.login(:'b');
select tests.ok(tests.throws(format($$ insert into public.dm_reactions (message_id, user_id, emoji) values (%L, %L, '😂') $$, tests.id('alice_msg'), :'a')),
  'nobody reacts as someone else');
select tests.login(:'a');
select public.delete_dm_message(tests.id('alice_msg'));
reset role;
select tests.ok((select body = '' and deleted_at is not null from public.dm_messages where id = tests.id('alice_msg')), 'Alice soft-deletes her own message');
select tests.ok((select count(*) = 0 from public.dm_reactions where message_id = tests.id('alice_msg')), 'its reactions go with it');
set role authenticated;

-- ── reports go to the operator, with a copy of the text
select tests.login(:'a');
insert into t_ids select 'bob_msg', id from public.dm_messages where conversation_id = tests.id('ab') and body = 'hi alice';
select tests.ok(tests.throws(format($$ select public.report_dm(%L, 'spam') $$, (select id from public.dm_messages where conversation_id = tests.id('ab') and body = 'again'))),
  'you cannot report your own message');
select public.report_dm(tests.id('bob_msg'), 'harassment', 'not ok');
select tests.login(:'e');
select tests.ok(tests.throws(format($$ select public.report_dm(%L, 'spam') $$, tests.id('bob_msg'))), 'outsiders cannot report a DM they cannot read');
reset role;
select tests.ok((select community_id is null and dm_author_id = :'b' and dm_snapshot = 'hi alice' and reason = 'harassment'
                 from public.reports where dm_message_id = tests.id('bob_msg')), 'the report keeps the author and the text');
set role authenticated;

-- ── blocks, both directions
select tests.login(:'j');
insert into t_ids values ('jk', public.start_dm(array[:'k']::uuid[], 'hi kim'));
select tests.login(:'k');
select public.accept_dm_request(tests.id('jk'));
select tests.login(:'j');
select public.block_user(:'k');
select tests.ok((select count(*) = 1 from public.blocks where blocked_id = :'k'), 'Jo sees her block');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'one more') $$, tests.id('jk'))), 'the blocker cannot post in the 1:1');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'hey') $$, :'k')), 'or start it again');
select tests.ok((select count(*) = 0 from public.my_dm_inbox() where id = tests.id('jk')), 'the blocker''s inbox hides the 1:1');
select tests.ok((select count(*) = 1 from public.my_blocks() where id = :'k'), 'my_blocks lists Kim');
select tests.login(:'k');
select tests.ok((select count(*) = 0 from public.blocks), 'Kim cannot see that Jo blocked her');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'why?') $$, tests.id('jk'))), 'the blocked person cannot post either');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'hey') $$, :'j')), 'or start a conversation with the blocker');
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L, %L]::uuid[], 'group') $$, :'j', :'a')), 'or put the blocker in a group');
select tests.ok(tests.throws(format($$ insert into public.dm_reactions (message_id, user_id, emoji)
  select id, %L, '👍' from public.dm_messages where conversation_id = %L limit 1 $$, :'k', tests.id('jk'))), 'or react in the 1:1');
select tests.ok(tests.throws($$ select public.block_user(auth.uid()) $$), 'nobody blocks themselves');
select tests.login(:'j');
select public.unblock_user(:'k');
select tests.say(tests.id('jk'), 'sorry');
select tests.ok(tests.visible(tests.id('jk')) = 2, 'after unblocking, they talk again');

-- In a group nobody is silenced, but the blocker hears nothing from the person they blocked.
select tests.login(:'a');
insert into t_ids values ('g_jk', public.start_dm(array[:'j', :'k']::uuid[], 'jo and kim'));
select tests.login(:'j');
select public.accept_dm_request(tests.id('g_jk'));
select tests.login(:'k');
select public.accept_dm_request(tests.id('g_jk'));
select public.block_user(:'j');
select tests.login(:'j');
select tests.say(tests.id('g_jk'), 'jo in the group');
reset role;
select tests.ok((select count(*) = 0 from realtime.messages where topic = 'user:' || :'k' and event = 'dm'
                 and payload -> 'message' ->> 'author_id' = :'j' and payload ->> 'conversation_id' = tests.id('g_jk')::text),
  'Kim (who blocked Jo) gets no event for Jo''s group message');
select tests.ok((select count(*) = 1 from realtime.messages where topic = 'user:' || :'a' and event = 'dm'
                 and payload -> 'message' ->> 'body' = 'jo in the group'), 'Alice does');
set role authenticated;
select tests.login(:'k');
select tests.ok((select unread = 1 from public.my_dm_inbox() where id = tests.id('g_jk')),
  'messages from someone you blocked do not count as unread (only Alice''s does)');
select public.unblock_user(:'j');

-- ── groups: up to 10 people
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select public.start_dm(array(select ('b1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid
  from generate_series(1, 10) as n), 'eleven of us') $$)), 'a group of 11 is refused');
insert into t_ids values ('g10', public.start_dm(array(select ('b1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid
  from generate_series(1, 9) as n), 'ten of us'));
reset role;
select tests.ok((select count(*) = 10 from public.dm_members where conversation_id = tests.id('g10')), 'a group of 10 is fine');
set role authenticated;
select tests.ok(tests.throws(format($$ select public.add_to_group(%L, array[%L]::uuid[]) $$, tests.id('g10'), :'f10')),
  'adding an 11th person is refused');
select tests.ok(tests.throws(format($$ select public.add_to_group(%L, array[%L]::uuid[]) $$, tests.id('ab'), :'d')),
  'you cannot add people to a 1:1');
select tests.ok(tests.throws(format($$ select public.leave_dm(%L) $$, tests.id('ab'))), 'or leave a 1:1');
select public.rename_dm_group(tests.id('g10'), '  The ten  ');
select tests.ok((select title = 'The ten' from public.dm_conversations where id = tests.id('g10')), 'active members rename a group');
select tests.ok(tests.throws(format($$ select public.rename_dm_group(%L, %L) $$, tests.id('g10'), repeat('x', 65))), 'names are 64 characters at most');
select tests.login(:'f9');
select tests.ok(tests.throws(format($$ select public.add_to_group(%L, array[%L]::uuid[]) $$, tests.id('g10'), :'f10')),
  'a request member cannot add people');
select public.leave_dm(tests.id('g10'));
select tests.login(:'a');
select public.add_to_group(tests.id('g10'), array[:'f10']::uuid[]);
reset role;
select tests.ok((select count(*) = 10 from public.dm_members where conversation_id = tests.id('g10') and status <> 'left'),
  'after someone leaves, there is room for one more');
set role authenticated;

-- ── leaving: you keep what you could read, and nothing after
select tests.login(:'f1');
select public.accept_dm_request(tests.id('g10'));
select public.leave_dm(tests.id('g10'));
reset role;
-- Everything in this test shares one now(); move the clock back for what happened before leaving.
update public.dm_messages set created_at = now() - interval '2 minutes' where conversation_id = tests.id('g10');
update public.dm_members set left_at = now() - interval '1 minute' where conversation_id = tests.id('g10') and user_id = :'f1';
set role authenticated;
select tests.login(:'a');
select tests.say(tests.id('g10'), 'after f1 left');
select tests.login(:'f1');
select tests.ok(tests.visible(tests.id('g10')) = 1, 'a member who left reads the old message only');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'back?') $$, tests.id('g10'))), 'and cannot post');
select tests.ok((select count(*) = 0 from public.my_dm_inbox() where id = tests.id('g10')), 'the group leaves their inbox');
reset role;
select tests.ok((select count(*) = 0 from realtime.messages where topic = 'user:' || :'f1' and event = 'dm'
                 and payload -> 'message' ->> 'body' = 'after f1 left'), 'and no event reaches them');
set role authenticated;
select tests.login(:'a');
select public.add_to_group(tests.id('g10'), array[:'f1']::uuid[]);
reset role;
select tests.ok((select status = 'request' and left_at is null from public.dm_members where conversation_id = tests.id('g10') and user_id = :'f1'),
  'someone who left can be added back, as a request');
set role authenticated;

-- ── the flood guard: 30 a minute per person, as in rooms
select tests.login(:'h');
select public.accept_dm_request(tests.id('group_ba'));
insert into t_ids values ('hi', public.start_dm(array[:'i']::uuid[], 'one'));
select tests.say_many(tests.id('hi'), 29);
select tests.ok(tests.visible(tests.id('hi')) = 30, '30 messages in a minute go through');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'thirty-one') $$, tests.id('hi'))), 'the 31st is refused');
select tests.ok(tests.throws(format($$ select tests.say(%L, 'in another conversation') $$, tests.id('group_ba'))), 'in any conversation');

-- ── unread counts and read state
reset role;
update public.dm_members set last_read_at = now() - interval '5 minutes' where conversation_id = tests.id('hi') and user_id = :'i';
set role authenticated;
select tests.login(:'i');
select tests.ok((select unread = 30 and status = 'request' from public.my_dm_inbox() where id = tests.id('hi')), 'Ivy has 30 unread in her request');
select public.mark_dm_read(tests.id('hi'));
select tests.ok((select unread = 0 from public.my_dm_inbox() where id = tests.id('hi')), 'marking it read clears the count');
select public.set_dm_muted(tests.id('hi'), true);
select tests.ok((select muted from public.my_dm_inbox() where id = tests.id('hi')), 'members mute a conversation for themselves');

-- ── search for "New message"
select tests.login(:'a');
select tests.ok((select count(*) = 1 from public.dm_search_people('bob') where id = :'b' and can_message), 'Alice finds Bob from her community');
select tests.ok((select count(*) = 1 from public.dm_search_people('carol11') where id = :'c'), 'and Carol by her exact username (she takes messages from anyone)');
select tests.ok((select count(*) = 0 from public.dm_search_people('carol')), 'but not by part of it');
select tests.ok((select count(*) = 0 from public.dm_search_people('eve11')), 'Eve (default setting, no shared community) is not found');
select tests.ok((select count(*) = 0 from public.dm_search_people('%')), 'wildcards are matched literally');
select tests.login(:'d');
select public.set_who_can_dm('nobody');
select tests.login(:'b');
select tests.ok((select not can_message from public.dm_search_people('dave11') where id = :'d'), 'people who take no messages show as such');

-- ── nothing goes to community or room topics
reset role;
select tests.ok((select count(*) = 0 from realtime.messages where event like 'dm%' and topic not like 'user:%'), 'DM events only go to user topics');
select tests.ok((select count(*) = 0 from public.usage_daily), 'DMs are not metered');

-- ── room slug dm is reserved
set role authenticated;
select tests.login(:'a');
select tests.ok(tests.throws(format($$ insert into public.rooms (community_id, slug, name) values (%L, 'dm', 'dm') $$, :'c1')),
  'no room can take the slug dm');

-- ── function grants
reset role;
set role anon;
select tests.ok(tests.throws(format($$ select public.start_dm(array[%L]::uuid[], 'anon') $$, :'b')), 'anon cannot start a DM');
select tests.ok(tests.throws($$ select * from public.my_dm_inbox() $$), 'anon has no inbox');
reset role;
set role authenticated;
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select public.dm_allowed(%L, %L) $$, :'b', :'c')), 'dm_allowed is internal');
select tests.ok(tests.throws(format($$ select public.is_blocked_pair(%L, %L) $$, :'j', :'k')), 'is_blocked_pair is internal');
select tests.ok(tests.throws(format($$ select public.dm_talked(%L, %L) $$, :'b', :'a')), 'dm_talked is internal');
select tests.ok(tests.throws(format($$ select public.dm_notify_members(%L, 'dm', '{}') $$, tests.id('ab'))), 'dm_notify_members is internal');
select tests.ok(tests.throws($$ insert into public.dm_conversations (is_group) values (true) $$), 'conversations are only made by start_dm');
select tests.ok(tests.throws(format($$ insert into public.dm_members (conversation_id, user_id) values (%L, %L) $$, tests.id('g10'), :'e')),
  'members are only added by functions');
select tests.ok(tests.throws($$ insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'b1000000-0000-0000-0000-00000000000e') $$),
  'blocks are only made by block_user');

reset role;
rollback;
