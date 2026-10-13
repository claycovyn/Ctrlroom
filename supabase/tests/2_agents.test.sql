-- @ctrl / @openctrl jobs (0002_agents.sql).
\set QUIET on
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000201', 'ana@example.com', '{"username":"ana"}'),
  ('00000000-0000-0000-0000-000000000202', 'ben@example.com', '{"username":"ctrl"}'),
  ('00000000-0000-0000-0000-000000000203', 'cy@example.com', '{"username":"cy"}');

select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-000000000202') ~ '^ctrl[0-9]{4}$', 'people can''t take a bot handle');
set role authenticated;
select tests.login('00000000-0000-0000-0000-000000000201');
select id as c from public.create_community('Agents', 'agents-crew') \gset
select id as general from public.rooms where community_id = :'c' and slug = 'general' \gset
select tests.ok((select count(*) from public.profiles where is_bot) = 2, 'bots are visible to everyone');
select tests.ok(tests.throws($$ update public.profiles set is_bot = true where id = '00000000-0000-0000-0000-000000000201' $$), 'can''t make yourself a bot');

insert into public.messages (room_id, author_id, body) values (:'general', '00000000-0000-0000-0000-000000000201', 'hey @ctrl what''s new in Postgres 17? also @OpenCtrl how do invites work')
  returning id as ask \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'ask') = 2, 'one job per bot mentioned');
select tests.ok((select bool_and(status = 'queued' and thread_id = :'ask'::uuid) from public.bot_jobs where message_id = :'ask'), 'queued, answer goes in its thread');
insert into public.messages (room_id, author_id, body) values (:'general', '00000000-0000-0000-0000-000000000201', 'email me at x@ctrl.com, see @ctrlroom and @openctrl_fan')
  returning id as noise \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'noise') = 0, 'only exact handles trigger a job');
insert into public.messages (room_id, author_id, body, parent_id) values (:'general', '00000000-0000-0000-0000-000000000201', '@ctrl follow-up', :'ask')
  returning id as followup \gset
select tests.ok((select thread_id from public.bot_jobs where message_id = :'followup') = :'ask'::uuid, 'asking inside a thread answers in that thread');
select tests.ok(tests.throws($$ insert into public.bot_jobs (bot, message_id, room_id, community_id, requested_by, thread_id) select 'ctrl', id, room_id, community_id, author_id, id from public.messages limit 1 $$), 'users can''t create jobs');
select tests.ok(tests.throws($$ update public.bot_jobs set status = 'done' $$), 'users can''t change jobs');
select tests.ok(tests.throws(format('select public.claim_bot_job(%L)', (select id from public.bot_jobs limit 1))), 'users can''t claim jobs');
select tests.ok((select count(*) from public.bot_jobs) = 3, 'members see their community''s jobs');

select tests.login('00000000-0000-0000-0000-000000000203');
select tests.ok((select count(*) from public.bot_jobs) = 0, 'outsiders see no jobs');
reset role;

-- server side: claim once, answer as the bot in the thread, no job loop
select tests.ok((select status from public.claim_bot_job((select id from public.bot_jobs where message_id = :'ask' and bot = 'ctrl'))) = 'running', 'claim');
select tests.ok((select count(*) from public.claim_bot_job((select id from public.bot_jobs where message_id = :'ask' and bot = 'ctrl')) where id is not null) = 0, 'claimed only once');
insert into public.messages (room_id, author_id, body, parent_id) values (:'general', '00000000-0000-4000-8000-00000000c7a1', '@ana Postgres 17 adds... ask @ctrl again anytime', :'ask');
select tests.ok((select count(*) from public.bot_jobs) = 3, 'bot replies never start new jobs');
select tests.ok(exists (select 1 from public.mentions where user_id = '00000000-0000-0000-0000-000000000201'), 'asker is pinged when the bot answers');
select tests.ok(exists (select 1 from realtime.messages where event = 'agent' and payload ->> 'status' = 'running'), 'job status is broadcast');

-- follow-ups and edits (0016)
update public.bot_jobs set status = 'done', reply_id = (select id from public.messages where parent_id = :'ask' and author_id = '00000000-0000-4000-8000-00000000c7a1' limit 1)
  where message_id = :'ask' and bot = 'ctrl';
insert into public.community_members (community_id, user_id) values (:'c', '00000000-0000-0000-0000-000000000203');
set role authenticated;
select tests.login('00000000-0000-0000-0000-000000000201');
insert into public.messages (room_id, author_id, body, parent_id) values (:'general', '00000000-0000-0000-0000-000000000201', 'thanks, and what about 18?', :'ask')
  returning id as more \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'more' and bot = 'ctrl' and thread_id = :'ask'::uuid) = 1, 'a reply in a thread the bot answered continues without @ctrl');
select tests.ok((select count(*) from public.bot_jobs where message_id = :'more' and bot = 'openctrl') = 0, 'only bots that already answered there');
insert into public.messages (room_id, author_id, body, parent_id) values (:'general', '00000000-0000-0000-0000-000000000201', '@cy what do you think?', :'ask')
  returning id as aside \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'aside') = 0, 'mentioning someone else is talking to them, not the bot');
insert into public.messages (room_id, author_id, body) values (:'general', '00000000-0000-0000-0000-000000000201', 'unrelated top-level message')
  returning id as top \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'top') = 0, 'top-level messages still need @ctrl');
select tests.login('00000000-0000-0000-0000-000000000203');
insert into public.messages (room_id, author_id, body, parent_id) values (:'general', '00000000-0000-0000-0000-000000000203', 'me too', :'ask')
  returning id as other \gset
select tests.ok((select count(*) from public.bot_jobs where message_id = :'other') = 0, 'someone who never asked here needs @ctrl');
update public.messages set body = 'me too @ctrl' where id = :'other';
select tests.ok((select count(*) from public.bot_jobs where message_id = :'other' and bot = 'ctrl') = 1, 'adding @ctrl in an edit asks');
update public.messages set body = 'me too @ctrl, edited again' where id = :'other';
select tests.ok((select count(*) from public.bot_jobs where message_id = :'other') = 1, 'editing again doesn''t ask twice');
select tests.ok(tests.throws($$ select public.queue_bot_job((select m from public.messages m limit 1), 'ctrl') $$), 'people can''t queue jobs directly');
reset role;

-- rate limit
do $$ begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', false); end $$;
set role authenticated;
insert into public.messages (room_id, author_id, body)
  select :'general', '00000000-0000-0000-0000-000000000201', '@ctrl q' || g from generate_series(1, 20) g;
select tests.ok((select count(*) from public.bot_jobs where status = 'limited') >= 1, 'per-person hourly limit');
reset role;
\echo all agent tests passed
