-- App-wide monthly budgets for paid outside services (first: Brave web search for @ctrl).
-- One row per service per UTC month. Only the server (service role) reads or takes from it.

create table public.service_quota (
  service text not null,
  month date not null,
  used int not null default 0,
  primary key (service, month)
);
alter table public.service_quota enable row level security;
revoke all on table public.service_quota from anon, authenticated;

-- Takes one slot for this UTC month if fewer than p_limit are used. Returns whether it got one.
-- A single upsert, so concurrent callers can never push `used` past the limit.
create function public.take_quota(p_service text, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  got int;
begin
  if p_limit is null or p_limit <= 0 then return false; end if;
  insert into public.service_quota as q (service, month, used)
  values (p_service, date_trunc('month', now() at time zone 'utc')::date, 1)
  on conflict (service, month) do update set used = q.used + 1
    where q.used < p_limit
  returning q.used into got;
  return got is not null;
end $$;

-- Slots used this UTC month (for /admin).
create function public.quota_used(p_service text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select used from public.service_quota
                   where service = p_service and month = date_trunc('month', now() at time zone 'utc')::date), 0)
$$;

-- New functions are executable by PUBLIC by default; only the server may call these.
revoke execute on function public.take_quota(text, int), public.quota_used(text) from public, anon, authenticated;
grant execute on function public.take_quota(text, int), public.quota_used(text) to service_role;
