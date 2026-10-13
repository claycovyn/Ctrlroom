-- @ctrl / @openctrl keep the conversation going (0002_agents.sql started it).
--
-- 1. Follow-ups: in a thread where a bot has already answered you, your next reply there gets an answer without
--    writing @ctrl again. Not when the reply @mentions someone else (then you're talking to them), and only for
--    people who asked that bot in that thread themselves, so a thread can't be turned into a free-for-all.
-- 2. Edits: adding @ctrl to a message by editing it asks, the same as sending it with the mention.
-- Same rate limits as before. Bot replies never start jobs (no loops).

create or replace function public.queue_bot_job(p_msg public.messages, p_bot text) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int;
  community_today int;
begin
  select count(*) into mine from public.bot_jobs
    where requested_by = p_msg.author_id and community_id = p_msg.community_id and created_at > now() - interval '1 hour';
  select count(*) into community_today from public.bot_jobs
    where community_id = p_msg.community_id and created_at > now() - interval '1 day';
  insert into public.bot_jobs (bot, message_id, room_id, community_id, requested_by, thread_id, status)
  values (
    p_bot, p_msg.id, p_msg.room_id, p_msg.community_id, p_msg.author_id, coalesce(p_msg.parent_id, p_msg.id),
    case when mine >= public.bot_limit_per_hour() or community_today >= public.bot_limit_per_day() then 'limited' else 'queued' end
  )
  on conflict (message_id, bot) do nothing;
end $$;

-- The bots a message names, lowercased.
create or replace function public.bot_mentions(p_body text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(coalesce(p_body, ''), '(?:^|[^a-zA-Z0-9_])@(ctrl|openctrl)(?![a-zA-Z0-9_])', 'gi') as m
$$;

-- The bots a thread reply continues a conversation with: they answered in this thread, the author asked them here
-- before, and the reply names no other handle.
create or replace function public.bot_followups(p_msg public.messages) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct j.bot), '{}')
  from public.bot_jobs j
  where p_msg.parent_id is not null
    and j.thread_id = p_msg.parent_id
    and j.requested_by = p_msg.author_id
    and j.reply_id is not null
    and not exists (
      select 1 from regexp_matches(coalesce(p_msg.body, ''), '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{1,32})', 'g') as h
      where lower(h[1]) not in ('ctrl', 'openctrl')
    )
$$;

create or replace function public.messages_agent_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b text;
begin
  if new.deleted_at is not null or (select is_bot from public.profiles where id = new.author_id) then
    return new;
  end if;
  for b in select distinct x from unnest(public.bot_mentions(new.body) || public.bot_followups(new)) as x loop
    perform public.queue_bot_job(new, b);
  end loop;
  return new;
end $$;

create or replace function public.messages_agent_jobs_on_edit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b text;
begin
  if new.deleted_at is not null or (select is_bot from public.profiles where id = new.author_id) then
    return new;
  end if;
  for b in select x from unnest(public.bot_mentions(new.body)) as x where not (x = any (public.bot_mentions(old.body))) loop
    perform public.queue_bot_job(new, b);
  end loop;
  return new;
end $$;

create trigger messages_agent_jobs_on_edit after update of body on public.messages
  for each row when (old.body is distinct from new.body) execute function public.messages_agent_jobs_on_edit();

revoke execute on function public.queue_bot_job(public.messages, text) from public, anon, authenticated;
revoke execute on function public.bot_followups(public.messages) from public, anon, authenticated;
revoke execute on function public.messages_agent_jobs_on_edit() from public, anon, authenticated;
grant execute on function public.bot_mentions(text) to authenticated;
