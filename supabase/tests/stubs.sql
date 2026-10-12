-- Minimal stand-ins for the parts of Supabase the migration depends on, so the schema,
-- policies and functions can be tested against plain Postgres (scripts/db-test.sh).
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema realtime;
create table realtime.messages (id bigserial primary key, topic text, event text, payload jsonb, private boolean);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql as $$ insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private) $$;
grant usage on schema realtime to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
