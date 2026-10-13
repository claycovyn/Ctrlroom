-- Push tests for 0014_push.sql: people see and change only their own devices and settings; mentions and replies
-- queue a push (never for the author, never in a muted room, never with the kind turned off or in quiet hours,
-- never without a device); duplicates collapse; one nudge per transaction; the dispatch secret and the outbox are
-- out of reach of signed-in people; delivery functions are service role only.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-00000000000a', 'ann12@example.com', '{"username":"ann12","display_name":"Ann"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'ben12@example.com', '{"username":"ben12","display_name":"Ben"}'),
  ('b0000000-0000-0000-0000-00000000000c', 'cat12@example.com', '{"username":"cat12","display_name":"Cat"}'),
  ('b0000000-0000-0000-0000-00000000000d', 'out12@example.com', '{"username":"out12","display_name":"Out"}');
\set ann b0000000-0000-0000-0000-00000000000a
\set ben b0000000-0000-0000-0000-00000000000b
\set cat b0000000-0000-0000-0000-00000000000c
\set out b0000000-0000-0000-0000-00000000000d
\set c b1000000-0000-0000-0000-000000000001
\set room b2000000-0000-0000-0000-000000000001
\set quiet b2000000-0000-0000-0000-000000000002

insert into public.communities (id, slug, name, owner_id, is_public) values (:'c', 'push-test', 'Push test', :'ann', false);
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'ann', 'owner'), (:'c', :'ben', 'member'), (:'c', :'cat', 'member');
insert into public.rooms (id, community_id, slug, name, position) values
  (:'room', :'c', 'general', 'general', 0), (:'quiet', :'c', 'quiet', 'quiet', 1);
update private.push_config set dispatch_url = 'https://ctrlroom.test/api/push/dispatch', secret = repeat('s3cr3t', 8);

set role authenticated;

-- ── subscriptions: your own rows only
select tests.login(:'ben');
select public.save_push_subscription('https://push.example.com/ben-phone', 'BEN-p256dh-key-aaaaaaaaaaaaaaaa', 'ben-auth-key', 'iPhone');
select tests.ok((select count(*) from public.push_subscriptions) = 1, 'ben sees his device');
select tests.ok(tests.throws($$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('b0000000-0000-0000-0000-00000000000c', 'https://push.example.com/x', 'xxxxxxxxxxxxxxxxxxxxxxxx', 'xxxxxxxxxx') $$),
  'no direct insert (not even as someone else)');
select tests.ok(tests.throws($$ update public.push_subscriptions set user_id = 'b0000000-0000-0000-0000-00000000000c' $$),
  'no direct update');
select tests.ok(tests.throws($$ select public.save_push_subscription('http://push.example.com/plain', 'BEN-p256dh-key-aaaaaaaaaaaaaaaa', 'ben-auth-key') $$),
  'endpoints must be https');
select tests.ok(tests.throws($$ select public.save_push_subscription('https://push.example.com/bad', 'not a key!', 'ben-auth-key') $$),
  'keys are validated');

select tests.login(:'cat');
select public.save_push_subscription('https://push.example.com/cat-laptop', 'CAT-p256dh-key-aaaaaaaaaaaaaaaa', 'cat-auth-key', 'Firefox');
select tests.ok((select count(*) from public.push_subscriptions) = 1, 'cat sees only her own device');
delete from public.push_subscriptions where endpoint = 'https://push.example.com/ben-phone';
reset role;
select tests.ok(exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/ben-phone'),
  'cat cannot delete ben''s device');
set role authenticated;

-- Signing in as someone else on the same browser moves the endpoint to them.
select tests.login(:'out');
select public.save_push_subscription('https://push.example.com/shared', 'OUT-p256dh-key-aaaaaaaaaaaaaaaa', 'out-auth-key');
select tests.login(:'ann');
select public.save_push_subscription('https://push.example.com/shared', 'ANN-p256dh-key-aaaaaaaaaaaaaaaa', 'ann-auth-key');
reset role;
select tests.ok((select user_id from public.push_subscriptions where endpoint = 'https://push.example.com/shared') = :'ann',
  'a re-registered endpoint belongs to whoever registered it last');
select tests.ok((select count(*) from public.push_subscriptions where endpoint = 'https://push.example.com/shared') = 1, '... once');
set role authenticated;

-- ── preferences: your own row only
select tests.login(:'cat');
insert into public.push_prefs (user_id, mentions, replies) values (:'cat', true, false);
select tests.ok(tests.throws(format($$ insert into public.push_prefs (user_id) values (%L) $$, :'ben')), 'cannot create prefs for someone else');
select tests.ok(tests.throws($$ update public.push_prefs set tz = 'Not/AZone' $$), 'unknown time zones are refused');
select tests.ok(tests.throws($$ update public.push_prefs set quiet_start = 60 $$), 'quiet hours need a start and an end');
select tests.login(:'ben');
select tests.ok((select count(*) from public.push_prefs) = 0, 'ben cannot see cat''s prefs');
update public.push_prefs set mentions = false;
reset role;
select tests.ok((select mentions from public.push_prefs where user_id = :'cat'), 'ben cannot change cat''s prefs');
set role authenticated;

-- ── the outbox, the config and the delivery functions are out of reach
select tests.login(:'ben');
select tests.ok(tests.throws($$ select * from public.push_outbox $$), 'outbox is not readable');
select tests.ok(tests.throws($$ insert into public.push_outbox (user_id, kind, title, url) values ('b0000000-0000-0000-0000-00000000000b', 'mention', 'x', '/') $$),
  'outbox is not writable');
select tests.ok(tests.throws($$ select * from private.push_config $$), 'the dispatch secret is not readable');
select tests.ok(tests.throws($$ select public.enqueue_push('b0000000-0000-0000-0000-00000000000c', 'mention', 'spam', 'spam', '/') $$),
  'people cannot queue pushes for others');
select tests.ok(tests.throws($$ select * from public.claim_push(10) $$), 'people cannot claim pushes');
select tests.ok(tests.throws($$ select public.finish_push('{}', '{}', '{https://push.example.com/cat-laptop}') $$),
  'people cannot delete others'' devices through finish_push');
select tests.ok(tests.throws($$ select public.push_call_started('sid', 'b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b') $$),
  'people cannot announce calls');
select tests.ok(tests.throws($$ select public.push_nudge() $$), 'people cannot nudge directly');
select tests.ok(tests.throws($$ select * from net.sent $$), 'people cannot read the pg_net queue');
reset role;
set role anon;
select tests.ok(tests.throws($$ select public.save_push_subscription('https://push.example.com/anon', 'ANO-p256dh-key-aaaaaaaaaaaaaaaa', 'anon-auth-key') $$),
  'anon cannot subscribe');
select tests.ok(tests.throws($$ select * from public.push_subscriptions $$), 'anon cannot list devices');
reset role;
set role authenticated;

-- ── mentions queue a push; the author never gets one
select tests.login(:'ann');
insert into public.messages (id, room_id, author_id, body) values
  ('b3000000-0000-0000-0000-000000000001', :'room', :'ann', 'hey @ben12 and @ann12 and @out12, ship it?');
reset role;
select tests.ok((select count(*) from public.push_outbox where user_id = :'ben' and kind = 'mention') = 1, 'ben is pushed for his mention');
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'ann'), 'the author is never pushed');
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'out'), 'non-members are never pushed');
select tests.ok((select title from public.push_outbox where user_id = :'ben') = 'Ann mentioned you in #general', 'title names who and where');
select tests.ok((select url from public.push_outbox where user_id = :'ben') = '/c/push-test/general?m=b3000000-0000-0000-0000-000000000001',
  'url opens the message');
select tests.ok((select tag from public.push_outbox where user_id = :'ben') = 'room:' || :'room', 'tag groups by room');
select tests.ok((select count(*) from net.sent) = 1, 'one nudge for the transaction');
select tests.ok((select headers ->> 'Authorization' from net.sent) = 'Bearer ' || repeat('s3cr3t', 8), 'nudge carries the secret');
select tests.ok((select url from net.sent) = 'https://ctrlroom.test/api/push/dispatch', 'nudge goes to the dispatch route');

-- Two mentions in one (new) transaction: one nudge. The flag is transaction-local; clearing it stands in for a commit.
delete from net.sent;
select set_config('ctrlroom.push_nudged', '', true);
set role authenticated;
select tests.login(:'ben');
insert into public.messages (room_id, author_id, body) values (:'room', :'ben', '@ann12 @cat12 lunch?');
reset role;
select tests.ok((select count(*) from public.push_outbox where user_id in (:'ann', :'cat') and kind = 'mention') = 2, 'both mentioned people queued');
select tests.ok((select count(*) from net.sent) = 1, 'one nudge for two pushes in the same transaction');

-- Replies: cat turned replies off.
set role authenticated;
select tests.login(:'cat');
insert into public.messages (id, room_id, author_id, body) values ('b3000000-0000-0000-0000-000000000002', :'room', :'cat', 'my question');
select tests.login(:'ben');
insert into public.messages (room_id, author_id, body, parent_id) values (:'room', :'ben', 'an answer', 'b3000000-0000-0000-0000-000000000002');
reset role;
select tests.ok(exists (select 1 from public.mentions where user_id = :'cat' and kind = 'reply'), 'the reply mention exists');
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'cat' and kind = 'reply'), 'replies off: no push');

-- Muted room: no push.
set role authenticated;
select tests.login(:'ben');
select public.set_room_notify(:'quiet', 'none');
select tests.login(:'ann');
insert into public.messages (room_id, author_id, body) values (:'quiet', :'ann', 'psst @ben12');
reset role;
select tests.ok(exists (select 1 from public.mentions m join public.messages x on x.id = m.message_id where m.user_id = :'ben' and x.room_id = :'quiet'),
  'the mention is still recorded in the muted room');
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'ben' and url like '/c/push-test/quiet%'), 'muted room: no push');

-- Mentions turned off: no push.
insert into public.push_prefs (user_id, mentions) values (:'ben', false);
set role authenticated;
select tests.login(:'ann');
insert into public.messages (room_id, author_id, body) values (:'room', :'ann', 'again @ben12');
reset role;
select tests.ok((select count(*) from public.push_outbox where user_id = :'ben' and kind = 'mention') = 1, 'mentions off: no new push');
update public.push_prefs set mentions = true where user_id = :'ben';

-- Quiet hours covering the whole day except one minute: no push; the window maths wraps midnight.
select tests.ok(public.push_in_quiet(23 * 60, 22 * 60, 7 * 60) and public.push_in_quiet(60, 22 * 60, 7 * 60)
  and not public.push_in_quiet(12 * 60, 22 * 60, 7 * 60), 'quiet hours wrap past midnight');
select tests.ok(public.push_in_quiet(600, 540, 1020) and not public.push_in_quiet(1020, 540, 1020), 'quiet hours within a day');
select tests.ok(not public.push_in_quiet(600, 600, 600), 'an empty window is never quiet');
update public.push_prefs set quiet_start = (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int + 1439) % 1440,
  quiet_end = (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int + 2) % 1440,
  tz = 'UTC' where user_id = :'ben';
set role authenticated;
select tests.login(:'ann');
insert into public.messages (room_id, author_id, body) values (:'room', :'ann', 'quiet @ben12');
reset role;
select tests.ok((select count(*) from public.push_outbox where user_id = :'ben' and kind = 'mention') = 1, 'quiet hours: no push');
update public.push_prefs set quiet_start = null, quiet_end = null where user_id = :'ben';

-- No device: nothing queued.
delete from public.push_subscriptions where user_id = :'cat';
set role authenticated;
select tests.login(:'ann');
insert into public.messages (room_id, author_id, body) values (:'room', :'ann', 'ping @cat12');
reset role;
select tests.ok((select count(*) from public.push_outbox where user_id = :'cat') = 1, 'no device: no push queued');

-- Duplicates collapse on the collapse key.
select tests.ok(public.enqueue_push(:'ann', 'dm', 'Ben', 'hi', '/app', 'dm:1', 'dm:msg-1', :'ben'), 'enqueue_push queues a dm');
select tests.ok(not public.enqueue_push(:'ann', 'dm', 'Ben', 'hi', '/app', 'dm:1', 'dm:msg-1', :'ben'), 'the same collapse key does not');
select tests.ok(not public.enqueue_push(:'ann', 'dm', 'Ann', 'hi', '/app', 'dm:1', 'dm:msg-2', :'ann'), 'never to the sender');
select tests.ok(tests.throws($$ select public.enqueue_push('b0000000-0000-0000-0000-00000000000a', 'spam', 'x', 'x', '/') $$), 'kind is checked');
select tests.ok(tests.throws($$ select public.enqueue_push('b0000000-0000-0000-0000-00000000000a', 'dm', 'x', 'x', 'https://evil.example') $$),
  'urls stay on this site');
select tests.ok(tests.throws($$ select public.enqueue_push('b0000000-0000-0000-0000-00000000000a', 'dm', 'x', 'x', '//evil.example') $$),
  'protocol-relative urls are refused');

-- ── calls: the first join of a session announces it to people who use the room
update public.room_state set last_read_at = now() where room_id = :'room';
insert into public.room_state (room_id, user_id, last_read_at) values (:'room', :'ann', now()) on conflict (room_id, user_id) do update set last_read_at = now();
insert into public.room_state (room_id, user_id, last_read_at) values (:'room', :'ben', now()) on conflict (room_id, user_id) do update set last_read_at = now();

select tests.ok(public.push_call_started('RM_session1', :'room', :'ben') = 1, 'call start queues for the room''s regulars (ann)');
select tests.ok(public.push_call_started('RM_session1', :'room', :'cat') = 0, 'later joins of the same session do nothing');
select tests.ok(public.push_call_started('RM_session2', :'room', :'out') = 0, 'non-members cannot announce calls');
reset role;
select tests.ok((select title from public.push_outbox where user_id = :'ann' and kind = 'call') = 'Ben started a call in #general', 'call title');
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'ben' and kind = 'call'), 'the caller is not pushed');

-- ── delivery: claim, finish, dead endpoints removed

select tests.ok((select count(*) from public.claim_push(100)) = (select count(*) from public.push_outbox), 'claim takes every pending row');
select tests.ok((select count(*) from public.claim_push(100)) = 0, 'a claimed row is not claimed twice right away');
reset role;
update public.push_outbox set claimed_at = now() - interval '3 minutes';

select tests.ok((select count(*) from public.claim_push(1)) = 1, 'a stuck claim is retried, and the limit holds');
reset role;
update public.push_outbox set attempts = 3;

select tests.ok((select count(*) from public.claim_push(100)) = 0, 'after three attempts a row is dropped');
reset role;
select tests.ok((select count(*) from public.push_outbox) = 0, '... and deleted');
select public.enqueue_push(:'ben', 'dm', 'Ann', 'old', '/app', '', '', :'ann');
update public.push_outbox set created_at = now() - interval '2 hours';

select tests.ok((select count(*) from public.claim_push(100)) = 0, 'rows older than an hour are not sent');
select public.enqueue_push(:'ben', 'dm', 'Ann', 'new', '/app', '', '', :'ann');
select public.finish_push((select array_agg(id) from public.claim_push(100)), '{https://push.example.com/ben-phone}', '{https://push.example.com/shared}');
reset role;
select tests.ok((select count(*) from public.push_outbox) = 0, 'finished rows are deleted');
select tests.ok(not exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/shared'), 'gone endpoints are deleted');
select tests.ok((select last_used_at is not null from public.push_subscriptions where endpoint = 'https://push.example.com/ben-phone'), 'working endpoints are stamped');

-- ── without a dispatch config there is no nudge (the app's own nudge delivers)
update private.push_config set dispatch_url = null;
select set_config('ctrlroom.push_nudged', '', true);
delete from net.sent;
select public.enqueue_push(:'ben', 'dm', 'Ann', 'x', '/app', '', 'nocfg', :'ann');
select tests.ok((select count(*) from net.sent) = 0, 'no config: no nudge');
update private.push_config set dispatch_url = 'https://ctrlroom.test/api/push/dispatch';
select public.enqueue_push(:'ben', 'dm', 'Ann', 'x', '/app', '', 'withcfg', :'ann');
select tests.ok((select count(*) from net.sent) = 1, 'with config: a nudge');

-- ── direct messages (0011): active members are pushed; a request rings once; never muted, ignored, left or blocking
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-0000000000d1', 'dee12@example.com', '{"username":"dee12","display_name":"Dee"}'),
  ('b0000000-0000-0000-0000-0000000000e1', 'eve12@example.com', '{"username":"eve12","display_name":"Eve"}'),
  ('b0000000-0000-0000-0000-0000000000f1', 'fay12@example.com', '{"username":"fay12","display_name":"Fay"}'),
  ('b0000000-0000-0000-0000-0000000000a1', 'gus12@example.com', '{"username":"gus12","display_name":"Gus"}');
\set dee b0000000-0000-0000-0000-0000000000d1
\set eve b0000000-0000-0000-0000-0000000000e1
\set fay b0000000-0000-0000-0000-0000000000f1
\set gus b0000000-0000-0000-0000-0000000000a1
insert into public.community_members (community_id, user_id) values (:'c', :'dee'), (:'c', :'eve'), (:'c', :'fay'), (:'c', :'gus');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (:'dee', 'https://push.example.com/dee', 'DEE-p256dh-key-aaaaaaaaaaaaaaaa', 'dee-auth-key'),
  (:'eve', 'https://push.example.com/eve', 'EVE-p256dh-key-aaaaaaaaaaaaaaaa', 'eve-auth-key'),
  (:'fay', 'https://push.example.com/fay', 'FAY-p256dh-key-aaaaaaaaaaaaaaaa', 'fay-auth-key'),
  (:'gus', 'https://push.example.com/gus', 'GUS-p256dh-key-aaaaaaaaaaaaaaaa', 'gus-auth-key');
delete from public.push_outbox;
create table tests.dm_ids (k text primary key, id uuid);
grant all on tests.dm_ids to authenticated;
create function tests.dm(p text) returns uuid language sql as $$ select id from tests.dm_ids where k = p $$;
grant execute on function tests.dm(text) to authenticated;
create function tests.dm_pushes(p_user uuid) returns int language sql as $$
  select count(*)::int from public.push_outbox where user_id = p_user and kind = 'dm' $$;

set role authenticated;
select tests.login(:'dee');
insert into tests.dm_ids values ('de', public.start_dm(array[:'eve']::uuid[], 'hello eve'));
reset role;
select tests.ok((select status from public.dm_members where conversation_id = tests.dm('de') and user_id = :'eve') = 'request', 'eve gets a request');
select tests.ok(tests.dm_pushes(:'eve') = 1, 'a new request rings once');
select tests.ok((select title from public.push_outbox where user_id = :'eve') = 'Dee wants to message you', 'request title');
select tests.ok((select url from public.push_outbox where user_id = :'eve') = '/app/dm/' || tests.dm('de'), 'tap opens the conversation');
select tests.ok((select tag from public.push_outbox where user_id = :'eve') = 'dm:' || tests.dm('de'), 'tag groups by conversation');
select tests.ok(tests.dm_pushes(:'dee') = 0, 'the author is not pushed');

set role authenticated;
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('de'), :'dee', 'are you there?');
reset role;
select tests.ok(tests.dm_pushes(:'eve') = 1, 'follow-ups to a waiting request do not ring again');

set role authenticated;
select tests.login(:'eve');
select public.accept_dm_request(tests.dm('de'));
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('de'), :'dee', 'thanks for accepting');
reset role;
select tests.ok(tests.dm_pushes(:'eve') = 2, 'once accepted, every message is pushed');
select tests.ok((select title from public.push_outbox where user_id = :'eve' order by id desc limit 1) = 'Dee', 'a one-to-one push is titled with the sender');

set role authenticated;
select tests.login(:'eve');
select public.set_dm_muted(tests.dm('de'), true);
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('de'), :'dee', 'muted?');
reset role;
select tests.ok(tests.dm_pushes(:'eve') = 2, 'a muted conversation is not pushed');

-- Groups: eve has talked with dee (active), fay and gus get requests.
set role authenticated;
select tests.login(:'dee');
insert into tests.dm_ids values ('grp', public.start_dm(array[:'eve', :'fay', :'gus']::uuid[], 'group hi', 'Plans'));
reset role;
select tests.ok(tests.dm_pushes(:'eve') = 3, 'an active group member is pushed (muting the other conversation does not carry over)');
select tests.ok((select title from public.push_outbox where user_id = :'eve' order by id desc limit 1) = 'Dee in Plans', 'group title');
select tests.ok(tests.dm_pushes(:'fay') = 1 and tests.dm_pushes(:'gus') = 1, 'group requests ring once each');

-- eve blocks dee: no more pushes from dee, in any conversation.
set role authenticated;
select tests.login(:'eve');
select public.block_user(:'dee');
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('grp'), :'dee', 'after the block');
reset role;
select tests.ok(tests.dm_pushes(:'eve') = 3, 'someone who blocked the author is not pushed');

-- Ignored and left. Moving joined_at past the earlier messages makes the next one the first since they were added,
-- so only ignoring or leaving can be what keeps it quiet.
set role authenticated;
select tests.login(:'gus');
select public.ignore_dm_request(tests.dm('grp'));
reset role;
update public.dm_members set joined_at = now() + interval '1 second' where conversation_id = tests.dm('grp') and user_id in (:'fay', :'gus');
set role authenticated;
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('grp'), :'dee', 'first since you joined');
reset role;
select tests.ok(tests.dm_pushes(:'fay') = 2, 'control: a request member is pushed for the first message since joining');
select tests.ok(tests.dm_pushes(:'gus') = 1, 'an ignored request is never pushed');
set role authenticated;
select tests.login(:'fay');
select public.leave_dm(tests.dm('grp'));
select tests.login(:'dee');
insert into public.dm_messages (conversation_id, author_id, body) values (tests.dm('grp'), :'dee', 'after fay left');
reset role;
select tests.ok(tests.dm_pushes(:'fay') = 2, 'people who left are not pushed');

-- Blocks apply to room mentions too.
set role authenticated;
select tests.login(:'dee');
insert into public.messages (room_id, author_id, body) values (:'room', :'dee', 'hey @eve12');
reset role;
select tests.ok(not exists (select 1 from public.push_outbox where user_id = :'eve' and kind = 'mention'), 'a mention from someone you blocked is not pushed');
select tests.ok(exists (select 1 from public.mentions m join public.messages x on x.id = m.message_id where m.user_id = :'eve' and x.author_id = :'dee'),
  'the mention itself is still recorded');

-- ── privileges
select tests.ok(not has_function_privilege('authenticated', 'public.enqueue_push(uuid, text, text, text, text, text, text, uuid)', 'execute'),
  'authenticated cannot call enqueue_push');
select tests.ok(has_function_privilege('authenticated', 'public.save_push_subscription(text, text, text, text)', 'execute'),
  'authenticated can subscribe');
select tests.ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text)', 'execute'), 'anon cannot');
select tests.ok(has_function_privilege('service_role', 'public.claim_push(int)', 'execute'), 'service role can claim');
select tests.ok(not has_table_privilege('authenticated', 'public.push_outbox', 'select'), 'no select grant on the outbox');
select tests.ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'no usage on the private schema');

rollback;
