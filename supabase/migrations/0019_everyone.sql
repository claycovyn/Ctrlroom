-- Ctrl Room — @everyone: a mod, admin or owner can ping the whole community from a room.
--
-- A top-level message or a thread reply whose text has @everyone (as a word, any case) writes a public.mentions row
-- for every member except the author and the bots, the same rows an @username writes (0001). So everything a mention
-- does follows: the room's mention badge, the in-app ping on user:<id>, the catch-up count, and the phone push
-- (0014 mentions_push: never in a room you muted, never from someone you blocked, never in quiet hours).
-- Members (and anyone below mod) can type @everyone; it's just text and pings nobody.
-- "everyone" is no longer a username a person can have: existing ones get a suffix, as 0002 did for the bot handles.

update public.profiles
  set username = substr(username, 1, 24) || '_' || floor(random() * 9000 + 1000)::int::text
  where username = 'everyone' and not is_bot;

-- New accounts asking for it get a suffix (handle_new_user picks the name); renaming to it is refused.
create or replace function public.profiles_reserved_username() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.username <> 'everyone' or new.is_bot then return new; end if;
  if tg_op = 'UPDATE' then
    raise exception 'CR: That username is taken.' using errcode = 'unique_violation';
  end if;
  new.username := 'everyone_' || floor(random() * 9000 + 1000)::int::text;
  return new;
end $$;

create trigger profiles_reserved_username before insert or update of username on public.profiles
  for each row execute function public.profiles_reserved_username();

create or replace function public.messages_everyone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Same word edges as an @username (0001); text inside ``` blocks counts too, as it does there.
  if new.body !~* '(^|[^a-z0-9_])@everyone([^a-z0-9_]|$)' then return null; end if;
  if not exists (
    select 1 from public.community_members cm
    where cm.community_id = new.community_id and cm.user_id = new.author_id and public.role_rank(cm.role) >= public.role_rank('mod')
  ) then
    return null;
  end if;
  insert into public.mentions (message_id, user_id, room_id, kind)
    select new.id, cm.user_id, new.room_id, 'mention'
    from public.community_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.community_id = new.community_id and cm.user_id <> new.author_id and not p.is_bot
  on conflict (message_id, user_id) do update set kind = 'mention';
  return null;
end $$;

-- Fires after messages_after_insert (name order), so a named @username or a reply already has its row.
create trigger messages_everyone after insert on public.messages
  for each row execute function public.messages_everyone();

revoke execute on function public.messages_everyone() from public, anon, authenticated;
revoke execute on function public.profiles_reserved_username() from public, anon, authenticated;
