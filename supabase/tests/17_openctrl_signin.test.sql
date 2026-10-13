-- Tests for 0017_openctrl_signin.sql: the OpenCtrl link table and email lookup are for the service role only.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ada@Example.com', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'bea@example.com', null);

-- ── signed-in people and visitors can't see or touch links, or look up accounts by email
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select tests.ok(tests.throws($$ select * from public.openctrl_links $$), 'authenticated can''t read links');
select tests.ok(tests.throws($$ insert into public.openctrl_links (sub, user_id) values ('s', '00000000-0000-0000-0000-0000000000a1') $$), 'authenticated can''t add a link');
select tests.ok(tests.throws($$ select * from public.openctrl_account_by_email('ada@example.com') $$), 'authenticated can''t look up emails');
reset role;
set role anon;
select tests.ok(tests.throws($$ select * from public.openctrl_links $$), 'anon can''t read links');
select tests.ok(tests.throws($$ select * from public.openctrl_account_by_email('ada@example.com') $$), 'anon can''t look up emails');
reset role;

-- ── the service role can
set role service_role;
select tests.ok((select id from public.openctrl_account_by_email(' ADA@example.com ')) = '00000000-0000-0000-0000-0000000000a1', 'lookup ignores case and spaces');
select tests.ok((select email_confirmed_at from public.openctrl_account_by_email('bea@example.com')) is null, 'lookup says whether the email is confirmed');
select tests.ok(not exists (select 1 from public.openctrl_account_by_email('nobody@example.com')), 'unknown email finds nothing');
insert into public.openctrl_links (sub, user_id) values ('sub-ada', '00000000-0000-0000-0000-0000000000a1');
select tests.ok(tests.throws($$ insert into public.openctrl_links (sub, user_id) values ('sub-ada', '00000000-0000-0000-0000-0000000000b2') $$), 'one OpenCtrl account links to one user');
select tests.ok(tests.throws($$ insert into public.openctrl_links (sub, user_id) values ('sub-other', '00000000-0000-0000-0000-0000000000a1') $$), 'one user links to one OpenCtrl account');
reset role;

-- ── deleting the user removes the link
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select tests.ok(not exists (select 1 from public.openctrl_links where sub = 'sub-ada'), 'link goes with the user');

rollback;
