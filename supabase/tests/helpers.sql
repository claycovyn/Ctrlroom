-- Shared assertion helpers for supabase/tests/*.test.sql (loaded by scripts/db-test.sh).
create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', label; end if;
end $$;

-- true when the statement errors (as the current role)
create function tests.throws(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

create function tests.login(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), false);
end $$;
grant execute on all functions in schema tests to authenticated, anon;

