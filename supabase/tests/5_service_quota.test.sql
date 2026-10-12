-- Service budget tests for 0005_service_quota.sql: take_quota stops at the limit, per service, per month, server only.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;
-- helpers.sql only opens the tests schema to anon and authenticated
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

set role service_role;

-- ── takes up to the limit, then refuses
select tests.ok(public.quota_used('web_search') = 0, 'nothing used yet');
select tests.ok(public.take_quota('web_search', 3), 'slot 1 of 3');
select tests.ok(public.take_quota('web_search', 3), 'slot 2 of 3');
select tests.ok(public.take_quota('web_search', 3), 'slot 3 of 3');
select tests.ok(not public.take_quota('web_search', 3), 'slot 4 of 3 refused');
select tests.ok(not public.take_quota('web_search', 3), 'still refused');
select tests.ok(public.quota_used('web_search') = 3, 'used stays at the limit');
select tests.ok(public.take_quota('web_search', 4), 'a raised limit allows one more');
select tests.ok(public.quota_used('web_search') = 4, 'used counts it');
select tests.ok(not public.take_quota('web_search', 2), 'a lowered limit refuses');
select tests.ok(public.quota_used('web_search') = 4, 'a refusal doesn''t count');

-- ── services are independent
select tests.ok(public.take_quota('other_api', 1), 'other service has its own budget');
select tests.ok(not public.take_quota('other_api', 1), 'other service stops at its own limit');
select tests.ok(public.quota_used('other_api') = 1 and public.quota_used('web_search') = 4, 'counts kept apart');

-- ── limit 0 (or less, or null) refuses and records nothing
select tests.ok(not public.take_quota('fresh', 0), 'limit 0 refuses');
select tests.ok(not public.take_quota('fresh', -5), 'negative limit refuses');
select tests.ok(not public.take_quota('fresh', null), 'null limit refuses');
select tests.ok(public.quota_used('fresh') = 0, 'nothing recorded');

reset role;
-- ── a new month starts from zero (last month's full row doesn't count)
insert into public.service_quota (service, month, used)
values ('old', (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date, 100);
set role service_role;
select tests.ok(public.quota_used('old') = 0, 'last month not counted');
select tests.ok(public.take_quota('old', 1), 'new month has a fresh budget');
reset role;
select tests.ok((select count(*) from public.service_quota where service = 'old') = 2, 'one row per month');

-- ── server only
select tests.ok(not has_function_privilege('authenticated', 'public.take_quota(text, int)', 'execute'), 'take_quota not for signed-in people');
select tests.ok(not has_function_privilege('anon', 'public.take_quota(text, int)', 'execute'), 'take_quota not for anon');
select tests.ok(not has_function_privilege('authenticated', 'public.quota_used(text)', 'execute'), 'quota_used not for signed-in people');
select tests.ok(not has_function_privilege('anon', 'public.quota_used(text)', 'execute'), 'quota_used not for anon');
select tests.ok(has_function_privilege('service_role', 'public.take_quota(text, int)', 'execute'), 'service role can take');

set role authenticated;
select tests.login('50000000-0000-0000-0000-00000000000a');
select tests.ok(tests.throws($$ select public.take_quota('web_search', 1000) $$), 'signed-in call to take_quota fails');
select tests.ok(tests.throws($$ select public.quota_used('web_search') $$), 'signed-in call to quota_used fails');
select tests.ok(tests.throws($$ select count(*) from public.service_quota $$), 'signed-in people can''t read the table');
select tests.ok(tests.throws($$ insert into public.service_quota (service, month, used) values ('web_search', current_date, 0) $$),
  'signed-in people can''t write the table');
reset role;
set role anon;
select tests.ok(tests.throws($$ select public.take_quota('web_search', 1000) $$), 'signed-out call to take_quota fails');
select tests.ok(tests.throws($$ select count(*) from public.service_quota $$), 'signed-out people can''t read the table');
reset role;
select tests.ok(public.quota_used('web_search') = 4, 'nothing changed by refused calls');

rollback;
\echo all service quota tests passed
