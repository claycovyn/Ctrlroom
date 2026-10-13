-- Presence tests for 0010_presence.sql: members track and receive presence on presence:<community_id>; nobody else
-- does; nobody can broadcast there; the 0001 topic rules are unchanged.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'own10@example.com', '{"username":"own10"}'),
  ('a0000000-0000-0000-0000-00000000000b', 'mem10@example.com', '{"username":"mem10"}'),
  ('a0000000-0000-0000-0000-00000000000c', 'out10@example.com', '{"username":"out10"}');
\set own a0000000-0000-0000-0000-00000000000a
\set mem a0000000-0000-0000-0000-00000000000b
\set out a0000000-0000-0000-0000-00000000000c
\set c a1000000-0000-0000-0000-000000000001
\set other a1000000-0000-0000-0000-000000000002
\set room a2000000-0000-0000-0000-000000000001

insert into public.communities (id, slug, name, owner_id, is_public) values
  (:'c', 'presence-test', 'Presence test', :'own', false),
  (:'other', 'presence-other', 'Presence other', :'out', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'mem', 'member'), (:'other', :'out', 'owner');
insert into public.rooms (id, community_id, slug, name, kind, position) values (:'room', :'c', 'lounge', 'lounge', 'voice', 0);

-- What Realtime itself keeps for the topic (rows a subscriber would be checked against).
insert into realtime.messages (topic, extension, event, payload) values
  ('presence:' || :'c', 'presence', 'sync', '{}'),
  ('presence:' || :'other', 'presence', 'sync', '{}');

-- try_track(topic, extension): an insert into realtime.messages as the current role with realtime.topic() set.
create function tests.try_track(p_topic text, p_ext text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  insert into realtime.messages (topic, extension, event, payload) values (p_topic, p_ext, 'track', '{}');
  return true;
exception when others then
  return false;
end $$;
create function tests.can_see(p_topic text) returns boolean language plpgsql as $$
declare n int;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*) into n from realtime.messages where topic = p_topic;
  return n > 0;
end $$;
grant execute on function tests.try_track(text, text), tests.can_see(text) to authenticated, anon;

set role authenticated;

-- ── members track and receive presence in their community
select tests.login(:'mem');
select tests.ok(tests.try_track('presence:' || :'c', 'presence'), 'a member tracks presence');
select tests.ok(tests.can_see('presence:' || :'c'), 'a member receives presence');
select tests.login(:'own');
select tests.ok(tests.try_track('presence:' || :'c', 'presence'), 'the owner tracks presence');

-- ── nobody may broadcast on a presence topic (no fake events), members included
select tests.login(:'mem');
select tests.ok(not tests.try_track('presence:' || :'c', 'broadcast'), 'a member cannot broadcast on presence:<id>');
select tests.ok(not tests.try_track('presence:' || :'c', 'postgres_changes'), 'only the presence extension is allowed');

-- ── non-members get nothing
select tests.login(:'out');
select tests.ok(not tests.try_track('presence:' || :'c', 'presence'), 'a non-member cannot track');
select tests.ok(not tests.can_see('presence:' || :'c'), 'a non-member cannot receive');
select tests.ok(tests.try_track('presence:' || :'other', 'presence'), '... but tracks in their own community');
select tests.login(:'mem');
select tests.ok(not tests.try_track('presence:' || :'other', 'presence'), 'a member of one community cannot track another');
select tests.ok(not tests.can_see('presence:' || :'other'), 'a member of one community cannot see another');

-- ── signed out
select tests.login(null);
select tests.ok(not tests.try_track('presence:' || :'c', 'presence'), 'no user: no track');
select tests.ok(not tests.can_see('presence:' || :'c'), 'no user: no receive');
reset role;
set role anon;
select tests.ok(not tests.try_track('presence:' || :'c', 'presence'), 'anon cannot track');
select tests.ok(not tests.can_see('presence:' || :'c'), 'anon cannot receive');
reset role;
set role authenticated;

-- ── malformed topics
select tests.login(:'mem');
select tests.ok(not tests.try_track('presence:' || upper(:'c'), 'presence'), 'uppercase id is refused');
select tests.ok(not tests.try_track('presence:' || :'c' || 'x', 'presence'), 'trailing junk is refused');
select tests.ok(not tests.try_track('presence:', 'presence'), 'empty id is refused');
select tests.ok(not tests.try_track('presence:' || 'a1000000-0000-0000-0000-00000000000', 'presence'), 'short id is refused');
select tests.ok(not tests.try_track('xpresence:' || :'c', 'presence'), 'prefix junk is refused');

-- ── 0001 topics unchanged: presence only on presence:<id>; room typing pings still work; community stays read-only
select tests.ok(not tests.try_track('community:' || :'c', 'presence'), 'no presence on community:<id>');
select tests.ok(not tests.try_track('community:' || :'c', 'broadcast'), 'no client broadcast on community:<id>');
select tests.ok(tests.try_track('room:' || :'room', 'broadcast'), 'typing pings on room:<id> still allowed');
select tests.ok(not tests.try_track('user:' || :'own', 'presence'), 'no presence on someone else''s user topic');

-- ── leaving the community ends it
reset role;
delete from public.community_members where community_id = :'c' and user_id = :'mem';
set role authenticated;
select tests.login(:'mem');
select tests.ok(not tests.try_track('presence:' || :'c', 'presence'), 'after leaving: no track');
select tests.ok(not tests.can_see('presence:' || :'c'), 'after leaving: no receive');

-- ── the helper isn't callable by anon
reset role;
select tests.ok(not has_function_privilege('anon', 'public.can_use_presence(text)', 'execute'), 'anon cannot call can_use_presence');
select tests.ok(has_function_privilege('authenticated', 'public.can_use_presence(text)', 'execute'), 'authenticated can call can_use_presence');

rollback;
