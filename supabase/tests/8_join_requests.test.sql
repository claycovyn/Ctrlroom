-- Join request tests for 0008_join_requests.sql: asking to join a private community, and owners/admins answering.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-00000000000a', 'own8@example.com', '{"username":"own8"}'),
  ('80000000-0000-0000-0000-00000000000b', 'adm8@example.com', '{"username":"adm8"}'),
  ('80000000-0000-0000-0000-00000000000c', 'mod8@example.com', '{"username":"mod8"}'),
  ('80000000-0000-0000-0000-00000000000d', 'mem8@example.com', '{"username":"mem8"}'),
  ('80000000-0000-0000-0000-00000000000e', 'req8@example.com', '{"username":"req8","display_name":"Rae Quest"}'),
  ('80000000-0000-0000-0000-00000000000f', 'two8@example.com', '{"username":"two8"}'),
  ('80000000-0000-0000-0000-000000000010', 'bad8@example.com', '{"username":"bad8"}'),
  ('80000000-0000-0000-0000-000000000011', 'spam8@example.com', '{"username":"spam8"}'),
  ('80000000-0000-0000-0000-000000000012', 'late8@example.com', '{"username":"late8"}'),
  ('80000000-0000-0000-0000-000000000013', 'inv8@example.com', '{"username":"inv8"}');
\set own 80000000-0000-0000-0000-00000000000a
\set adm 80000000-0000-0000-0000-00000000000b
\set mod 80000000-0000-0000-0000-00000000000c
\set mem 80000000-0000-0000-0000-00000000000d
\set req 80000000-0000-0000-0000-00000000000e
\set two 80000000-0000-0000-0000-00000000000f
\set bad 80000000-0000-0000-0000-000000000010
\set spam 80000000-0000-0000-0000-000000000011
\set late 80000000-0000-0000-0000-000000000012
\set inv 80000000-0000-0000-0000-000000000013
\set c 81000000-0000-0000-0000-000000000001
\set closed 81000000-0000-0000-0000-000000000002
\set gone 81000000-0000-0000-0000-000000000003

insert into public.communities (id, slug, name, description, owner_id, is_public) values
  (:'c', 'ask-test', 'Ask test', 'A private crew.', :'own', false),
  (:'closed', 'closed-test', 'Closed test', '', :'own', false),
  (:'gone', 'gone-test', 'Gone test', '', :'own', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'adm', 'admin'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member'),
  (:'closed', :'own', 'owner'), (:'gone', :'own', 'owner');
insert into public.bans (community_id, user_id, reason) values (:'c', :'bad', 'test');

select tests.ok((select not accepts_requests from public.communities where id = :'c'), 'communities start not accepting requests');

-- Profiles are public by default since 0020. The people here have turned their public profile off, so these tests
-- keep checking who can see a hidden profile (the rules from before 0020).
update public.profiles set public_profile = false where not is_bot;
set role authenticated;

-- ── the setting: owners and admins turn it on, mods and members can't
select tests.login(:'req');
select tests.ok((select count(*) from public.community_request_card('ask-test')) = 0, 'not findable before it accepts requests');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'non-accepting community blocked');

select tests.login(:'mod');
update public.communities set accepts_requests = true where id = :'c';
select tests.login(:'mem');
update public.communities set accepts_requests = true where id = :'c';
reset role;
select tests.ok((select not accepts_requests from public.communities where id = :'c'), 'mods and members cannot turn it on');
set role authenticated;
select tests.login(:'adm');
update public.communities set accepts_requests = true where id = :'c';
select tests.login(:'own');
update public.communities set accepts_requests = true where id = :'gone';
reset role;
select tests.ok((select accepts_requests from public.communities where id = :'c'), 'admin turns it on');
select tests.ok((select accepts_requests from public.communities where id = :'gone'), 'owner turns it on');
set role authenticated;

-- ── the request page: only the card fields, and communities_select is not loosened
select tests.login(:'req');
select tests.ok((select name = 'Ask test' and description = 'A private crew.' and not pending
                 from public.community_request_card('ASK-test')), 'signed-in non-member sees the card');
select tests.ok((select count(*) from public.communities where id = :'c') = 0, 'communities_select still hides it');
select tests.ok((select count(*) from public.rooms where community_id = :'c') = 0, 'rooms still hidden');
select tests.ok((select count(*) from public.community_request_card('closed-test')) = 0, 'other private communities stay unfindable');
select tests.login(null);
select tests.ok((select count(*) from public.community_request_card('ask-test')) = 0, 'no card without a session');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'no request without a session');
reset role;
set role anon;
select tests.ok(tests.throws($$ select * from public.community_request_card('ask-test') $$), 'signed out cannot call the card');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'signed out cannot request');
reset role;
set role authenticated;

-- ── requesting
select tests.login(:'req');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', repeat('x', 501)) $$), 'message over 500 characters blocked');
select public.request_to_join('ask-test', '  Friend of Mem. ');
select tests.ok((select status = 'pending' and message = 'Friend of Mem.' and decided_at is null
                 from public.join_requests where community_id = :'c' and user_id = :'req'), 'request is pending with the message');
select tests.ok((select pending from public.community_request_card('ask-test')), 'card shows the pending request');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', 'again') $$), 'duplicate pending request blocked');
select tests.ok(tests.throws(format($$ insert into public.join_requests (community_id, user_id) values (%L, %L) $$, :'c', :'req')),
  'no direct inserts');
select tests.ok(tests.throws(format($$ update public.join_requests set status = 'approved' where user_id = %L $$, :'req')),
  'no direct updates');
select tests.ok((select count(*) from public.community_members where community_id = :'c' and user_id = :'req') = 0,
  'a request is not membership');

select tests.login(:'mem');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'members cannot request');
select tests.login(:'own');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'the owner cannot request');
select tests.login(:'bad');
select tests.ok(tests.throws($$ select public.request_to_join('ask-test', '') $$), 'banned people cannot request');
select tests.login(:'two');
select tests.ok(tests.throws($$ select public.request_to_join('closed-test', '') $$), 'non-accepting community blocked for anyone');
select tests.ok(tests.throws($$ select public.request_to_join('nope-test', '') $$), 'unknown community blocked');
select public.request_to_join('ask-test', '');

-- admins hear about it on their own user topic; nothing goes to the community topic
reset role;
select tests.ok((select count(*) from realtime.messages where event = 'join_request' and topic = 'user:' || :'adm') >= 1
                and (select count(*) from realtime.messages where event = 'join_request' and topic = 'user:' || :'own') >= 1,
  'owner and admin get join_request events');
select tests.ok((select count(*) from realtime.messages where event = 'join_request'
                 and topic in ('user:' || :'mod', 'user:' || :'mem', 'community:' || :'c')) = 0,
  'mods, members and the community topic do not');
select tests.ok((select bool_and(payload = jsonb_build_object('community_id', :'c'::uuid)) from realtime.messages where event = 'join_request'),
  'the event carries only the community id');
set role authenticated;

-- ── who can read requests
select tests.login(:'req');
select tests.ok((select count(*) from public.join_requests) = 1, 'requester reads only their own request');
select tests.login(:'two');
select tests.ok((select count(*) from public.join_requests where user_id = :'req') = 0, 'requester cannot read others'' requests');
select tests.login(:'mem');
select tests.ok((select count(*) from public.join_requests) = 0, 'members cannot read requests');
select tests.ok((select count(*) from public.join_requests_for(:'c')) = 0, 'members get no request list');
select tests.login(:'mod');
select tests.ok((select count(*) from public.join_requests) = 0, 'mods cannot read requests');
select tests.ok((select count(*) from public.join_requests_for(:'c')) = 0, 'mods get no request list');
select tests.login(:'adm');
select tests.ok((select count(*) from public.join_requests where community_id = :'c') = 2, 'admin reads the community''s requests');
select tests.ok((select display_name = 'Rae Quest' and username = 'req8' and message = 'Friend of Mem.'
                 from public.join_requests_for(:'c') where user_id = :'req'), 'admin list has the requester''s name and message');
select tests.ok((select count(*) from public.profiles where id = :'req') = 0, 'profiles_select is not loosened');

-- ── deciding: owners and admins only
-- the request id, looked up as the superuser (RLS hides it from mods and members)
reset role;
select set_config('tests.rid', (select id::text from public.join_requests where user_id = :'req' and community_id = :'c'), false);
set role authenticated;
select tests.login(:'mod');
select tests.ok(tests.throws($$ select public.decide_join_request(current_setting('tests.rid')::uuid, true) $$), 'mods cannot approve');
select tests.ok(tests.throws($$ select public.decide_join_request(current_setting('tests.rid')::uuid, false) $$), 'mods cannot decline');
select tests.login(:'mem');
select tests.ok(tests.throws($$ select public.decide_join_request(current_setting('tests.rid')::uuid, true) $$), 'members cannot decide');
select tests.login(:'req');
select tests.ok(tests.throws($$ select public.decide_join_request(current_setting('tests.rid')::uuid, true) $$),
  'requesters cannot approve themselves');
reset role;
select tests.ok((select count(*) from public.community_members where community_id = :'c' and user_id = :'req') = 0
                and (select status = 'pending' from public.join_requests where user_id = :'req' and community_id = :'c'),
  'still pending after the refused attempts');
set role authenticated;

-- approve makes a member
select tests.login(:'adm');
select tests.ok((select public.decide_join_request(id, true) = 'approved' from public.join_requests_for(:'c') where user_id = :'req'),
  'admin approves');
reset role;
select tests.ok((select role = 'member' from public.community_members where community_id = :'c' and user_id = :'req'),
  'approve makes them a member');
select tests.ok((select status = 'approved' and decided_by = :'adm' and decided_at is not null
                 from public.join_requests where user_id = :'req' and community_id = :'c'), 'request marked approved by the admin');
set role authenticated;
select tests.login(:'own');
select tests.ok(tests.throws(format($$ select public.decide_join_request(id, false) from public.join_requests where user_id = %L $$, :'req')),
  'an answered request cannot be answered again');
select tests.login(:'req');
select tests.ok((select count(*) from public.communities where id = :'c') = 1, 'the new member sees the community');

-- decline doesn't
select tests.login(:'own');
select tests.ok((select public.decide_join_request(id, false) = 'declined' from public.join_requests_for(:'c') where user_id = :'two'),
  'owner declines');
reset role;
select tests.ok((select count(*) from public.community_members where community_id = :'c' and user_id = :'two') = 0,
  'decline does not make a member');
select tests.ok((select status = 'declined' and decided_by = :'own' from public.join_requests where user_id = :'two'),
  'request marked declined');
set role authenticated;

-- ── withdrawing, and the hourly limit (withdrawn requests still count)
select tests.login(:'spam');
select public.request_to_join('ask-test', '');
select public.cancel_join_request('ask-test');
reset role;
select tests.ok((select status = 'declined' and decided_by = :'spam' from public.join_requests where user_id = :'spam'),
  'requester withdraws their own request');
set role authenticated;
select tests.login(:'spam');
select tests.ok(not (select pending from public.community_request_card('ask-test')), 'card no longer shows it pending');
select public.request_to_join('ask-test', ''); select public.cancel_join_request('ask-test');
select public.request_to_join('ask-test', ''); select public.cancel_join_request('ask-test');
select public.request_to_join('ask-test', ''); select public.cancel_join_request('ask-test');
select public.request_to_join('ask-test', '');
select tests.ok(tests.throws($$ select public.request_to_join('gone-test', '') $$), 'sixth request in an hour blocked');
select tests.login(:'two');
select public.cancel_join_request('ask-test');
reset role;
select tests.ok((select status = 'declined' and decided_by = :'own' from public.join_requests where user_id = :'two'),
  'cancel touches only your own pending request');
set role authenticated;

-- ── banning declines a pending request; approving a banned person fails
select tests.login(:'late');
select public.request_to_join('ask-test', '');
select tests.login(:'adm');
select public.remove_member(:'c', :'late', true, 'no');
reset role;
select tests.ok((select status = 'declined' and decided_by = :'adm' from public.join_requests where user_id = :'late'),
  'banning declines their pending request');
delete from public.bans where community_id = :'c' and user_id = :'late';
set role authenticated;
select tests.login(:'late');
select public.request_to_join('ask-test', '');
reset role;
insert into public.bans (community_id, user_id, reason) values (:'c', :'late', 'again');
update public.join_requests set status = 'pending', decided_at = null, decided_by = null
  where id = (select id from public.join_requests where user_id = :'late' order by created_at desc limit 1);
set role authenticated;
select tests.login(:'adm');
select tests.ok(tests.throws(format($$ select public.decide_join_request(%L, true) $$,
  (select id from public.join_requests where user_id = :'late' and status = 'pending'))), 'approving a banned person fails');
reset role;
select tests.ok((select count(*) from public.community_members where community_id = :'c' and user_id = :'late') = 0, 'banned person not added');
set role authenticated;

-- ── joining with an invite closes a pending request
select tests.login(:'inv');
select public.request_to_join('ask-test', '');
reset role;
insert into public.invites (code, community_id, created_by) values ('ask8inv', :'c', :'own');
set role authenticated;
select tests.login(:'inv');
select public.join_with_invite('ask8inv');
reset role;
select tests.ok((select status = 'approved' and decided_by is null from public.join_requests where user_id = :'inv'),
  'joining with an invite closes the pending request');
set role authenticated;

-- ── takedown blocks requests, the card, and approving
select tests.login(:'two');
select public.request_to_join('gone-test', 'hi');
reset role;
update public.communities set taken_down_at = now(), taken_down_reason = 'test' where id = :'gone';
set role authenticated;
select tests.login(:'mem');
select tests.ok((select count(*) from public.community_request_card('gone-test')) = 0, 'taken-down community has no card');
select tests.ok(tests.throws($$ select public.request_to_join('gone-test', '') $$), 'takedown blocks requests');
select tests.login(:'own');
select tests.ok(tests.throws(format($$ select public.decide_join_request(id, true) from public.join_requests_for(%L) $$, :'gone')),
  'takedown blocks approving');
reset role;
select tests.ok((select count(*) from public.community_members where community_id = :'gone' and user_id = :'two') = 0
                and (select status = 'pending' from public.join_requests where community_id = :'gone' and user_id = :'two'),
  'takedown: not a member, request untouched');

-- ── privileges
select tests.ok(not has_function_privilege('authenticated', 'public.notify_join_requests(uuid)', 'execute'), 'notify not callable');
select tests.ok(not has_function_privilege('authenticated', 'public.join_requests_on_join()', 'execute')
                and not has_function_privilege('authenticated', 'public.join_requests_on_ban()', 'execute'), 'triggers not callable');
select tests.ok(not has_function_privilege('anon', 'public.decide_join_request(uuid, boolean)', 'execute')
                and not has_function_privilege('anon', 'public.join_requests_for(uuid)', 'execute')
                and not has_function_privilege('anon', 'public.cancel_join_request(text)', 'execute'), 'nothing callable signed out');
select tests.ok(not has_table_privilege('authenticated', 'public.join_requests', 'insert')
                and not has_table_privilege('authenticated', 'public.join_requests', 'update')
                and not has_table_privilege('authenticated', 'public.join_requests', 'delete')
                and not has_table_privilege('anon', 'public.join_requests', 'select'), 'only select is granted, to signed-in people');
select tests.ok(has_column_privilege('authenticated', 'public.communities', 'accepts_requests', 'update')
                and has_column_privilege('authenticated', 'public.communities', 'cover_url', 'update')
                and not has_column_privilege('authenticated', 'public.communities', 'taken_down_at', 'update')
                and not has_column_privilege('authenticated', 'public.communities', 'owner_id', 'update'),
  'the column grant adds accepts_requests and keeps the rest');

rollback;
\echo all join request tests passed
