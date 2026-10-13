-- OpenCtrl Cloud tests for 0003_cloud.sql: plans, metering, Free limits, calls, takedowns, reports.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;
create schema ct;
grant usage on schema ct to authenticated, anon, service_role;

create function ct.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', label; end if;
end $$;

-- The error text when the statement fails, or null when it succeeds (as the current role).
create function ct.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function ct.login(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
end $$;

create function ct.post(room uuid, who uuid, body text) returns text language plpgsql as $$
begin
  return ct.err(format('insert into public.messages (room_id, author_id, body) values (%L, %L, %L)', room, who, body));
end $$;
grant execute on all functions in schema ct to authenticated, anon, service_role;

-- ── before Cloud is on: sign-ups are unlimited (no plan row = grandfathered)
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-00000000000a', 'old@example.com', '{"username":"oldtimer"}'),
  ('10000000-0000-0000-0000-00000000000f', 'flood@example.com', '{"username":"flooder"}');
select ct.ok(public.plan_of('10000000-0000-0000-0000-00000000000a') = 'grandfathered', 'early account is grandfathered');
select ct.ok(not exists (select 1 from public.cloud_plans), 'no plan rows while Cloud is off');

-- ── Cloud on, tiny Free limits for the test
update public.cloud_config set enabled = true, free = '{"messages": 3, "call_minutes": 5, "ai_replies": 1}';
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-0000000000f1', 'free@example.com', '{"username":"freebie"}'),
  ('10000000-0000-0000-0000-0000000000c1', 'cloud@example.com', '{"username":"subscriber"}'),
  ('10000000-0000-0000-0000-0000000000b1', 'other@example.com', '{"username":"outsider"}'),
  ('10000000-0000-0000-0000-0000000000a1', 'asker@example.com', '{"username":"asker"}');
select ct.ok(public.plan_of('10000000-0000-0000-0000-0000000000f1') = 'free', 'new sign-up gets Free while Cloud is on');
update public.cloud_plans set plan = 'cloud' where user_id = '10000000-0000-0000-0000-0000000000c1';

set role authenticated;

-- ── Free owner: 3 messages, then new messages pause
select ct.login('10000000-0000-0000-0000-0000000000f1');
select (public.create_community('Free Co', 'freeco')).id as free_c \gset
select id as free_general from public.rooms where community_id = :'free_c' and slug = 'general' \gset
select id as free_lounge from public.rooms where community_id = :'free_c' and slug = 'lounge' \gset
select ct.ok(ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'one') is null, 'free post 1');
select ct.ok(ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'two') is null, 'free post 2');
select ct.ok(ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'three') is null, 'free post 3');
select ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'four') as paused \gset
select ct.ok(:'paused' like 'CR: Free Co has used this month''s free messages, so new messages are paused until %', 'Free limit pauses new messages: ' || :'paused');
select ct.ok(:'paused' like '%nothing has been deleted%', 'pause message says nothing was deleted');
select ct.ok((select count(*) from public.messages where community_id = :'free_c') = 3, 'history still readable at the limit');
select ct.ok((select count(*) from public.search_messages(:'free_c', 'two')) = 1, 'search still works at the limit');
select ct.ok((public.my_cloud_status() -> 'usage' ->> 'messages')::int = 3, 'status shows 3 messages used');
select ct.ok(public.my_cloud_status() ->> 'plan' = 'free', 'status shows the Free plan');
select ct.ok((public.my_cloud_status() ->> 'owns')::int = 1, 'status counts owned communities');

-- ── grandfathered owner is never limited
select ct.login('10000000-0000-0000-0000-00000000000a');
select (public.create_community('Old Co', 'oldco')).id as old_c \gset
select id as old_general from public.rooms where community_id = :'old_c' and slug = 'general' \gset
select ct.ok(ct.post(:'old_general', '10000000-0000-0000-0000-00000000000a', 'a') is null
         and ct.post(:'old_general', '10000000-0000-0000-0000-00000000000a', 'b') is null
         and ct.post(:'old_general', '10000000-0000-0000-0000-00000000000a', 'c') is null
         and ct.post(:'old_general', '10000000-0000-0000-0000-00000000000a', 'd') is null, 'grandfathered owner posts past the Free limit');

-- ── OpenCtrl Cloud subscriber is never paused
select ct.login('10000000-0000-0000-0000-0000000000c1');
select (public.create_community('Paid Co', 'paidco')).id as paid_c \gset
select id as paid_general from public.rooms where community_id = :'paid_c' and slug = 'general' \gset
select ct.ok(ct.post(:'paid_general', '10000000-0000-0000-0000-0000000000c1', '1') is null
         and ct.post(:'paid_general', '10000000-0000-0000-0000-0000000000c1', '2') is null
         and ct.post(:'paid_general', '10000000-0000-0000-0000-0000000000c1', '3') is null
         and ct.post(:'paid_general', '10000000-0000-0000-0000-0000000000c1', '4') is null, 'subscriber is never paused');

-- ── AI helpers: Free tier's AI answers run out, bot replies aren't "messages" and skip the flood guard
select ct.login('10000000-0000-0000-0000-0000000000a1');
select (public.create_community('AI Co', 'aico')).id as ai_c \gset
select id as ai_general from public.rooms where community_id = :'ai_c' and slug = 'general' \gset
select ct.ok(ct.post(:'ai_general', '10000000-0000-0000-0000-0000000000a1', '@ctrl first question') is null, 'asker posts');
select id as ai_job from public.bot_jobs where community_id = :'ai_c' \gset
select ct.ok((select status from public.bot_jobs where id = :'ai_job') = 'queued', 'first AI question is queued');
select ct.ok(ct.err(format('select public.record_ai_reply(%L)', :'ai_job')) is not null, 'users cannot record AI answers');
reset role;
set role service_role;
select public.record_ai_reply(:'ai_job');
select ct.ok(public.month_usage('10000000-0000-0000-0000-0000000000a1', 'ai_replies') = 1, 'AI answer metered for the owner');
reset role;
select ct.ok(bool_and(ct.post(:'ai_general', '00000000-0000-4000-8000-00000000c7a1', 'bot says ' || i) is null), 'bots skip the per-person flood guard')
  from generate_series(1, 35) i;
select ct.ok(public.month_usage('10000000-0000-0000-0000-0000000000a1', 'messages') = 1, 'bot replies are not counted as messages');
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000a1');
select ct.ok(ct.post(:'ai_general', '10000000-0000-0000-0000-0000000000a1', '@ctrl second question') is null, 'asker can still post');
select ct.ok((select status = 'limited' and error = 'cloud:ai_replies' from public.bot_jobs
              where community_id = :'ai_c' and id <> :'ai_job'), 'Free AI answers used up: the job is limited with the Cloud reason');
reset role;
select ct.ok(exists (select 1 from realtime.messages where event = 'agent' and payload ->> 'status' = 'limited'
                     and payload ->> 'id' = (select id::text from public.bot_jobs where community_id = :'ai_c' and id <> :'ai_job')),
             'the broadcast already says limited');
set role authenticated;

-- ── users can't read or write Cloud tables, or call internal functions
select ct.ok((select count(*) from public.usage_daily) = 0, 'usage rows hidden from users');
select ct.ok((select count(*) from public.cloud_plans) = 0, 'plan rows hidden from users');
select ct.ok(ct.err($$ insert into public.cloud_plans (user_id, plan) values ('10000000-0000-0000-0000-0000000000c1', 'cloud') $$) is not null, 'users cannot give themselves a plan');
select ct.ok(ct.err($$ update public.cloud_config set enabled = false $$) is null and (select count(*) from public.cloud_config) = 0, 'cloud_config invisible and unchanged');
select ct.ok(ct.err($$ select public.record_call('x', gen_random_uuid(), 99) $$) is not null, 'users cannot record calls');
select ct.ok(ct.err($$ select public.meter(gen_random_uuid(), gen_random_uuid(), 'messages', -5) $$) is not null, 'users cannot meter');
select ct.ok(ct.err($$ select public.month_usage('10000000-0000-0000-0000-0000000000f1', 'messages') $$) is not null, 'users cannot read others'' usage');
select ct.ok(ct.err($$ select * from public.cloud_admin_overview() $$) is not null, 'users cannot read the admin overview');
select ct.ok(ct.err($$ update public.communities set taken_down_at = now() where slug = 'paidco' $$) is not null, 'users cannot take down');

-- ── calls: metered by the webhook (service role), Free pauses new calls at the limit
reset role;
set role service_role;
select ct.ok(public.record_call('evt_1', :'free_lounge', 4), 'webhook records a call');
select ct.ok(not public.record_call('evt_1', :'free_lounge', 4), 'the same webhook event counts once');
select ct.ok(public.month_usage('10000000-0000-0000-0000-0000000000f1', 'call_minutes') = 4, 'call minutes metered once');
select ct.ok((select count(*) from public.cloud_admin_overview()) >= 3, 'admin overview lists workspaces');
select ct.ok((select (usage ->> 'messages')::int from public.cloud_admin_overview() where username = 'freebie') = 3, 'admin overview shows usage');
reset role;
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(public.call_allowed(:'free_lounge') is null, 'calls allowed under the limit');
reset role;
set role service_role;
select public.record_call('evt_2', :'free_lounge', 1);
reset role;
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(public.call_allowed(:'free_lounge') like 'Free Co has used this month''s free call minutes%', 'Free pauses new calls at the limit');
select ct.login('10000000-0000-0000-0000-0000000000b1');
select ct.ok(public.call_allowed(:'free_lounge') = 'Room not found', 'non-members cannot get calls');

-- ── email confirmation before going public (Cloud on)
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(ct.err(format($$ update public.communities set is_public = true where id = %L $$, :'free_c')) like 'CR: Confirm your email%', 'unconfirmed email cannot go public');
reset role;
update auth.users set email_confirmed_at = now() where id = '10000000-0000-0000-0000-0000000000f1';
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(ct.err(format($$ update public.communities set is_public = true where id = %L $$, :'free_c')) is null, 'confirmed email can go public');
select ct.ok((public.my_cloud_status() ->> 'email_confirmed')::boolean, 'status shows the confirmed email');

-- ── reports
select ct.login('10000000-0000-0000-0000-0000000000b1');
select ct.ok(ct.err(format($$ select public.report(%L, null, 'spam', 'ads') $$, :'free_c')) is null, 'anyone can report a public community');
select ct.ok(ct.err(format($$ select public.report(%L, null, 'spam') $$, :'old_c')) is not null, 'cannot report a private community you are not in');
select ct.ok(ct.err(format($$ select public.report(%L, null, 'nonsense') $$, :'free_c')) is not null, 'report reasons are a fixed list');
select ct.ok((select count(*) from public.reports) = 0, 'reports are hidden from users');
select ct.err(format($$ select public.report(%L, null, 'spam') $$, :'free_c')) from generate_series(1, 9);
select ct.ok(ct.err(format($$ select public.report(%L, null, 'spam') $$, :'free_c')) like 'CR: You''ve sent a lot of reports%', '10 reports an hour per person');

-- ── takedown: no new messages, joins or calls; public listing gone; history stays for members
reset role;
update public.communities set taken_down_at = now(), taken_down_reason = 'Spam' where id = :'free_c';
select ct.ok((select count(*) from public.reports where community_id = :'free_c') = 10, 'reports stored');
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000b1');
select ct.ok((select count(*) from public.communities where id = :'free_c') = 0, 'taken-down public community hidden from non-members');
select ct.ok(ct.err($$ select public.join_public('freeco') $$) is not null, 'cannot join a taken-down community');
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok((select count(*) from public.messages where community_id = :'free_c') = 3, 'members keep history after a takedown');
reset role;
update public.cloud_config set enabled = false;
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'x') like 'CR: This community was taken down%', 'no new messages after a takedown');
select ct.ok(public.call_allowed(:'free_lounge') like 'This community was taken down%', 'no calls after a takedown');

-- ── Cloud off: nobody is limited (self-hosted)
reset role;
update public.communities set taken_down_at = null where id = :'free_c';
set role authenticated;
select ct.login('10000000-0000-0000-0000-0000000000f1');
select ct.ok(ct.post(:'free_general', '10000000-0000-0000-0000-0000000000f1', 'self-hosted') is null, 'with Cloud off the Free owner posts again');
select ct.ok(public.call_allowed(:'free_lounge') is null, 'with Cloud off calls are allowed');

-- ── flood guard: 30 messages a minute per person
select ct.login('10000000-0000-0000-0000-00000000000f');
select (public.create_community('Flood', 'floodco')).id as flood_c \gset
select id as flood_general from public.rooms where community_id = :'flood_c' and slug = 'general' \gset
select ct.ok(bool_and(ct.post(:'flood_general', '10000000-0000-0000-0000-00000000000f', 'm' || i) is null), '30 quick messages are fine')
  from generate_series(1, 30) i;
select ct.ok(ct.post(:'flood_general', '10000000-0000-0000-0000-00000000000f', 'too many') like 'CR: You''re sending messages very fast%', '31st message in a minute is refused');

-- ── metering never deletes anything and never raises
reset role;
set client_min_messages = error;
select ct.ok(ct.err($$ select public.meter('10000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'messages', 1) $$) is null, 'meter() swallows its own errors');
select ct.ok((select sum(count) from public.usage_daily where owner_id = '10000000-0000-0000-0000-0000000000f1' and metric = 'messages') = 4, 'usage counts every message sent');

rollback;
\echo all cloud tests passed
