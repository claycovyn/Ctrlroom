-- Presence: who's Online, Away, In a call, Do not disturb, or Offline.
--
-- Uses Supabase Realtime Presence, which lives in the Realtime server's memory: no table, no write per heartbeat.
-- Each open community tracks on its own private topic, presence:<community_id>. It's a separate topic from
-- community:<id> (0001) on purpose: the browser client keeps one channel per topic, and the community topic is a
-- broadcast channel the sidebar already owns.
--
-- Realtime authorizes a private channel with RLS on realtime.messages, per extension:
--   * receive (select): members of the community see who's here. Non-members, signed-out visitors and malformed
--     topics get nothing.
--   * track (insert): members may track presence there and nothing else. Broadcast inserts on presence:<id> are
--     refused, so nobody can push fake events into it. The 0001 policies are unchanged (ctrlroom_send still only
--     allows room:<id>, ctrlroom_receive still never matches presence:<id>).
-- People who choose "Appear offline" never join the channel, so they're simply absent: Offline.
--
-- What a payload says (status, call) comes from the person's own browser; the app validates its shape and keys it
-- by the presence key it was tracked under (src/lib/presence.ts).

create or replace function public.can_use_presence(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if (select auth.uid()) is null or p_topic is null then return false; end if;
  if p_topic ~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.is_member(substr(p_topic, 10)::uuid);
  end if;
  return false;
end $$;

create policy ctrlroom_presence_receive on realtime.messages for select to authenticated
  using (public.can_use_presence(realtime.topic()));

create policy ctrlroom_presence_track on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'presence' and public.can_use_presence(realtime.topic()));

revoke execute on function public.can_use_presence(text) from public, anon;
grant execute on function public.can_use_presence(text) to authenticated;
