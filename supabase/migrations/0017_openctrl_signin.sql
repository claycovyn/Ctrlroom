-- "Continue with OpenCtrl": which OpenCtrl account (the OIDC `sub`) signs in as which Ctrl Room user.
-- Only the sign-in bridge (service role) reads or writes it: row-level security is on with no policies, and the API
-- roles have no privileges on it.
create table public.openctrl_links (
  sub text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  linked_at timestamptz not null default now()
);
alter table public.openctrl_links enable row level security;
revoke all on public.openctrl_links from anon, authenticated;

-- The bridge looks up an existing account by email to decide whether it may link it. auth.users isn't reachable
-- through the API, so this runs as the definer, for the service role only.
create function public.openctrl_account_by_email(p_email text)
returns table (id uuid, email_confirmed_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email_confirmed_at from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1
$$;

revoke execute on function public.openctrl_account_by_email(text) from public, anon, authenticated;
grant execute on function public.openctrl_account_by_email(text) to service_role;
