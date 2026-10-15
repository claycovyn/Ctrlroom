-- @everyone tests for 0019_everyone.sql: a mod, admin or owner pings every member (not the author, not the bots, not
-- people outside the community); a member's @everyone pings nobody; it has to be the whole word; a reply counts too;
-- "everyone" can't be a person's username.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-00000000000a', 'own19@example.com', '{"username":"own19","display_name":"Own"}'),
  ('e0000000-0000-0000-0000-00000000000b', 'mod19@example.com', '{"username":"mod19","display_name":"Mod"}'),
  ('e0000000-0000-0000-0000-00000000000c', 'mem19@example.com', '{"username":"mem19","display_name":"Mem"}'),
  ('e0000000-0000-0000-0000-00000000000d', 'out19@example.com', '{"username":"out19","display_name":"Out"}'),
  ('e0000000-0000-0000-0000-00000000000e', 'eve19@example.com', '{"username":"everyone","display_name":"Eve"}');
\set own e0000000-0000-0000-0000-00000000000a
\set mod e0000000-0000-0000-0000-00000000000b
\set mem e0000000-0000-0000-0000-00000000000c
\set out e0000000-0000-0000-0000-00000000000d
\set eve e0000000-0000-0000-0000-00000000000e
\set c e1000000-0000-0000-0000-000000000001
\set room e2000000-0000-0000-0000-000000000001

-- ── the username is reserved
select tests.ok((select username from public.profiles where id = :'eve') <> 'everyone', 'a new account asking for "everyone" gets another name');
select tests.ok((select username from public.profiles where id = :'eve') like 'everyone_%', '... with a suffix');
select tests.ok(tests.throws(format($$ update public.profiles set username = 'everyone' where id = %L $$, :'mem')), 'no one can rename to "everyone"');

insert into public.communities (id, slug, name, owner_id, is_public) values (:'c', 'everyone-test', 'Everyone test', :'own', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member'), (:'c', :'eve', 'member');
insert into public.rooms (id, community_id, slug, name, position) values (:'room', :'c', 'general', 'general', 0);

set role authenticated;

-- ── a mod pings everyone but themself
select tests.login(:'mod');
insert into public.messages (id, room_id, author_id, body) values
  ('e3000000-0000-0000-0000-000000000001', :'room', :'mod', 'Heads up @everyone, call at 3');
reset role;
select tests.ok((select count(*) from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000001') = 3, 'mod: owner, member and eve are pinged');
select tests.ok(not exists (select 1 from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000001' and user_id = :'mod'), 'never the author');
select tests.ok(not exists (select 1 from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000001' and user_id = :'out'), 'never someone outside the community');
select tests.ok(not exists (select 1 from public.mentions m join public.profiles p on p.id = m.user_id
  where m.message_id = 'e3000000-0000-0000-0000-000000000001' and p.is_bot), 'never the AI helpers');
set role authenticated;

-- ── a member's @everyone is just text
select tests.login(:'mem');
insert into public.messages (id, room_id, author_id, body) values
  ('e3000000-0000-0000-0000-000000000002', :'room', :'mem', '@everyone look at this');
reset role;
select tests.ok(not exists (select 1 from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000002'), 'a member pings nobody');
set role authenticated;

-- ── the whole word, any case; a reply counts too
select tests.login(:'own');
insert into public.messages (id, room_id, author_id, body) values
  ('e3000000-0000-0000-0000-000000000003', :'room', :'own', 'mail me at x@everyonehere.test or @everyones');
insert into public.messages (id, room_id, author_id, body, parent_id) values
  ('e3000000-0000-0000-0000-000000000004', :'room', :'own', 'Reminder: @Everyone.', 'e3000000-0000-0000-0000-000000000001');
reset role;
select tests.ok(not exists (select 1 from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000003'), 'not part of another word');
select tests.ok((select count(*) from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000004') = 3, 'a reply from the owner pings mod, member and eve');
select tests.ok((select kind from public.mentions where message_id = 'e3000000-0000-0000-0000-000000000004' and user_id = :'mod') = 'mention',
  'the thread starter gets one ping (a mention), not two');

rollback;
