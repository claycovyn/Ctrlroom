-- Ctrl Room — files and images in chat: room messages, thread replies and direct messages.
--
-- Bytes live in a PRIVATE Supabase Storage bucket `attachments`; nothing in it is public. Paths:
--   room/<community id>/<room id>/<attachment id>/<file name>
--   dm/<conversation id>/<attachment id>/<file name>
-- The database picks the path (create_attachment), so a file always sits under the room or conversation it was
-- uploaded for, and the file name is reduced to safe ASCII with an extension that matches its type.
--
-- How sending works:
--   1. create_attachment() checks you can post there and reserves a row in message_attachments (pending: no message).
--   2. The browser uploads to that exact path. Storage only accepts the upload while the pending row is yours and you
--      can still post there (can_upload_attachment). The bucket itself refuses anything over 10 MB or of another type.
--   3. post_message() / post_dm() insert the message and, in the same statement, the attachments trigger links up to
--      10 of your pending, uploaded files to it (in the order given, with an optional description per image). A message
--      can then have an empty body. The message event (message / dm) already carries its attachments.
--   Pending files nobody sent are removed after 24 hours (attachments_cleanup, called by the daily cron).
--
-- Who can do what (the same rules as the messages they belong to):
--   read      rooms: members of the community; DMs: active and request members, and people who left for what was sent
--             before they left (0011 dm_can_read). Your own pending files: you.
--   upload    rooms: members of the community, not while it's taken down (0003) or while its messages are paused on
--             the Free tier; DMs: active members who may post (blocks and "who can message you", as in 0011).
--   delete    deleting a message (soft delete) removes its attachments. Removing a pending file: the uploader.
--             The bytes are then removed through the Storage API by the uploader, by room mods and up, or by the
--             daily cron, whichever comes first (Postgres can't remove Storage bytes itself).
--
-- Limits: 10 MB per file (bucket, row check and link check), 10 files per message, the types below, at most 30
-- pending files and 200 new files an hour per person. DMs aren't metered (no community), so each person has a cap on
-- their total DM files: 500 MB by default (attachment_dm_cap_bytes), to protect a small Supabase project. Change it with
--   alter database postgres set ctrlroom.dm_files_cap_mb = '1000';
-- Cloud: bytes attached in a community are recorded in usage_daily as `attachment_bytes` for the community owner. It
-- is a cost-only number (like emails): there's no storage meter in openctrl.json, nothing is limited by it.
-- SVG and HTML are never accepted (they can run script). Images are served inline; everything else is downloaded
-- (the app asks for signed URLs with the `download` option, so Storage sends Content-Disposition: attachment).

-- ───────────────────────── types ─────────────────────────

-- The one list of allowed types: extension → type. Anything not here is refused.
create or replace function public.attachment_ext_mime(p_ext text) returns text
language sql immutable as $$
  select case lower(coalesce(p_ext, ''))
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'webp' then 'image/webp'
    when 'gif' then 'image/gif'
    when 'pdf' then 'application/pdf'
    when 'txt' then 'text/plain'
    when 'md' then 'text/markdown'
    when 'markdown' then 'text/markdown'
    when 'csv' then 'text/csv'
    when 'zip' then 'application/zip'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'mp3' then 'audio/mpeg'
    when 'm4a' then 'audio/mp4'
    when 'ogg' then 'audio/ogg'
    when 'oga' then 'audio/ogg'
    when 'wav' then 'audio/wav'
    when 'mp4' then 'video/mp4'
    when 'webm' then 'video/webm'
  end
$$;

-- The extension at the end of a path or file name, lower case.
create or replace function public.attachment_ext(p_name text) returns text
language sql immutable as $$
  select lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]{1,8})$'))
$$;

create or replace function public.attachment_max_bytes() returns bigint
language sql immutable as $$ select 10485760::bigint $$;

-- Each person's total for files in direct messages. Default 500 MB; see the header to change it.
create or replace function public.attachment_dm_cap_bytes() returns bigint
language sql stable as $$
  select coalesce(
    (select (v::bigint) * 1048576 from (select nullif(current_setting('ctrlroom.dm_files_cap_mb', true), '') as v) s
     where v ~ '^[0-9]{1,7}$'),
    524288000)
$$;

-- ───────────────────────── bucket ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ───────────────────────── tables ─────────────────────────

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  width int check (width is null or width between 1 and 20000),
  height int check (height is null or height between 1 and 20000),
  -- The sender's description of an image (alt text). Empty shows as "Image".
  alt text check (alt is null or char_length(alt) <= 300),
  position smallint not null default 0 check (position between 0 and 9),
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  conversation_id uuid references public.dm_conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  dm_message_id uuid references public.dm_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint message_attachments_type check (public.attachment_ext_mime(public.attachment_ext(path)) = mime),
  -- A room file or a DM file, never both; linked to at most one message, of its own kind.
  constraint message_attachments_scope check (
    (room_id is not null and community_id is not null and conversation_id is null and dm_message_id is null
     and path = 'room/' || community_id || '/' || room_id || '/' || id || '/' || substring(path from '[^/]+$'))
    or
    (conversation_id is not null and room_id is null and community_id is null and message_id is null
     and path = 'dm/' || conversation_id || '/' || id || '/' || substring(path from '[^/]+$'))),
  constraint message_attachments_file_name check (substring(path from '[^/]+$') ~ '^[A-Za-z0-9._() -]{1,100}$'),
  constraint message_attachments_image_size check (mime like 'image/%' or (width is null and height is null and alt is null))
);
create index message_attachments_message_idx on public.message_attachments (message_id) where message_id is not null;
create index message_attachments_dm_message_idx on public.message_attachments (dm_message_id) where dm_message_id is not null;
create index message_attachments_uploader_idx on public.message_attachments (uploader_id, created_at desc);
create index message_attachments_pending_idx on public.message_attachments (created_at)
  where message_id is null and dm_message_id is null;
create index message_attachments_community_idx on public.message_attachments (community_id) where community_id is not null;

-- Storage objects whose attachment is gone (message deleted, file removed, room or conversation deleted, unsent for
-- 24 hours). The bytes are removed through the Storage API; the row goes when the cron confirms. No foreign keys, so
-- it outlives whatever it came from.
create table public.attachment_trash (
  path text primary key,
  uploader_id uuid,
  community_id uuid,
  queued_at timestamptz not null default now()
);
create index attachment_trash_queued_idx on public.attachment_trash (queued_at);

-- Message bodies can be empty when the message has attachments (checked by the triggers below).
alter table public.messages drop constraint messages_body_len;
alter table public.messages add constraint messages_body_len check (deleted_at is not null or char_length(body) <= 4000);
alter table public.dm_messages drop constraint dm_messages_body_len;
alter table public.dm_messages add constraint dm_messages_body_len check (deleted_at is not null or char_length(body) <= 4000);

-- ───────────────────────── helpers ─────────────────────────

-- Internal: may the caller post in this conversation right now? Active, and in a 1:1 not blocked and (while the other
-- person hasn't accepted) still allowed by their "who can message you". The same rules as dm_messages_before_insert.
create or replace function public.attachment_dm_can_post(p_conv uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  grp boolean;
  other public.dm_members;
begin
  if uid is null or public.dm_status(p_conv) is distinct from 'active' then return false; end if;
  select is_group into grp from public.dm_conversations where id = p_conv;
  if grp is null then return false; end if;
  if not grp then
    select * into other from public.dm_members where conversation_id = p_conv and user_id <> uid;
    if other.user_id is not null and (public.is_blocked_pair(uid, other.user_id)
        or (other.status = 'request' and not public.dm_allowed(uid, other.user_id))) then
      return false;
    end if;
  end if;
  return true;
end $$;

-- Internal: may the caller upload into this room right now? Member, community not taken down, messages not paused.
create or replace function public.attachment_room_can_post(p_room uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c public.communities;
begin
  select co.* into c from public.rooms r join public.communities co on co.id = r.community_id where r.id = p_room;
  if not found or not public.is_member(c.id) or c.taken_down_at is not null then return false; end if;
  return not public.free_limit_reached(c.owner_id, 'messages');
end $$;

-- Storage policies (they run as the signed-in caller and only answer about the caller).

-- Upload or re-upload (retry): only to a path you reserved, still unsent, from the last 24 hours, where you can
-- still post. When Storage passes the file's size and type, they must match the limit and the reservation.
create or replace function public.can_upload_attachment(p_name text, p_metadata jsonb default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  a public.message_attachments;
  size_text text := p_metadata ->> 'size';
  mime_text text := split_part(coalesce(p_metadata ->> 'mimetype', ''), ';', 1);
begin
  select * into a from public.message_attachments
    where path = p_name and uploader_id = (select auth.uid())
      and message_id is null and dm_message_id is null and created_at > now() - interval '24 hours';
  if not found then return false; end if;
  if size_text ~ '^[0-9]+$' and size_text::numeric > public.attachment_max_bytes() then return false; end if;
  if mime_text <> '' and lower(mime_text) <> a.mime then return false; end if;
  if a.room_id is not null then return public.attachment_room_can_post(a.room_id); end if;
  return public.attachment_dm_can_post(a.conversation_id);
end $$;

-- Bytes waiting to be removed: the uploader, or (rooms) mods and up of that community.
create or replace function public.can_delete_attachment(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.attachment_trash t
    where t.path = p_name
      and (t.uploader_id = (select auth.uid()) or (t.community_id is not null and public.has_role(t.community_id, 'mod')))
  )
$$;

-- Read: whoever can read the message it's attached to; your own unsent files; and (so the Storage API can remove
-- them) bytes you may delete.
create or replace function public.can_read_attachment(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.message_attachments a
    left join public.messages m on m.id = a.message_id
    left join public.dm_messages d on d.id = a.dm_message_id
    where a.path = p_name and (
      (a.message_id is null and a.dm_message_id is null and a.uploader_id = (select auth.uid()))
      or (m.id is not null and m.deleted_at is null and public.is_member(m.community_id))
      or (d.id is not null and d.deleted_at is null and public.dm_can_read(d.conversation_id, d.created_at)))
  ) or public.can_delete_attachment(p_name)
$$;

-- What message events and post_message / post_dm return. Not security definer: inside the message triggers it runs as
-- their owner; called by a person, row-level security applies.
create or replace function public.attachments_json(p_message uuid, p_dm_message uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'path', a.path, 'name', a.name, 'mime', a.mime, 'size_bytes', a.size_bytes,
      'width', a.width, 'height', a.height, 'alt', a.alt, 'position', a.position) order by a.position, a.id), '[]'::jsonb)
  from public.message_attachments a
  where (p_message is not null and a.message_id = p_message) or (p_dm_message is not null and a.dm_message_id = p_dm_message)
$$;

-- Restated from 0001: message events now carry the message's attachments (none once it's deleted).
create or replace function public.message_payload(m public.messages) returns jsonb
language sql stable as $$
  select (to_jsonb(m) - 'search')
    || jsonb_build_object('attachments', case when m.deleted_at is null then public.attachments_json(m.id, null) else '[]'::jsonb end)
$$;

create or replace function public.dm_message_payload(m public.dm_messages) returns jsonb
language sql stable as $$
  select to_jsonb(m)
    || jsonb_build_object('attachments', case when m.deleted_at is null then public.attachments_json(null, m.id) else '[]'::jsonb end)
$$;

-- ───────────────────────── reserving and removing ─────────────────────────

-- Reserve an attachment before uploading it. Exactly one of p_room / p_conversation. Returns { id, path, name }: upload
-- the file to `path` in the attachments bucket with type p_mime, then send it with post_message / post_dm.
create or replace function public.create_attachment(
  p_room uuid, p_conversation uuid, p_name text, p_mime text, p_size bigint, p_width int default null, p_height int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  r public.rooms;
  c public.communities;
  shown text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]/\\]+', '', 'g'));
  ext text := public.attachment_ext(coalesce(p_name, ''));
  stem text;
  new_id uuid := gen_random_uuid();
  file_path text;
  is_image boolean := coalesce(p_mime, '') like 'image/%';
begin
  if uid is null then raise exception 'sign in first'; end if;
  if (select is_bot from public.profiles where id = uid) is distinct from false then raise exception 'not allowed'; end if;
  if (p_room is null) = (p_conversation is null) then raise exception 'pick a room or a conversation'; end if;
  if ext is null or public.attachment_ext_mime(ext) is distinct from lower(coalesce(p_mime, '')) then
    raise exception 'CR: That type of file can''t be sent here.' using errcode = 'check_violation';
  end if;
  if p_size is null or p_size < 1 then raise exception 'CR: That file is empty.' using errcode = 'check_violation'; end if;
  if p_size > public.attachment_max_bytes() then
    raise exception 'CR: Files can be up to 10 MB.' using errcode = 'check_violation';
  end if;
  if shown = '' then shown := 'file.' || ext; end if;
  if char_length(shown) > 200 then shown := left(shown, 199 - char_length(ext)) || '.' || ext; end if;
  stem := left(shown, char_length(shown) - char_length(ext) - 1);
  stem := btrim(left(btrim(regexp_replace(stem, '[^A-Za-z0-9._() -]+', '_', 'g'), ' ._'), 80), ' .');
  if stem = '' then stem := 'file'; end if;

  -- One person's reservations are counted one at a time.
  perform pg_advisory_xact_lock(hashtextextended('attachments:' || uid::text, 13));
  if (select count(*) from public.message_attachments
      where uploader_id = uid and message_id is null and dm_message_id is null and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'CR: You have a lot of files waiting to send. Send or remove some first.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.message_attachments where uploader_id = uid and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'CR: You''re uploading a lot of files. Wait a bit and try again.' using errcode = 'check_violation';
  end if;

  if p_room is not null then
    select * into r from public.rooms where id = p_room;
    if not found or not public.is_member(r.community_id) then raise exception 'room not found'; end if;
    select * into c from public.communities where id = r.community_id;
    if c.taken_down_at is not null then
      raise exception 'CR: This community was taken down, so new files are off.' using errcode = 'check_violation';
    end if;
    if public.free_limit_reached(c.owner_id, 'messages') then
      raise exception 'CR: % has used this month''s free messages, so new messages are paused until %. History, search and export still work, and nothing has been deleted.',
        c.name, public.next_reset_label();
    end if;
    file_path := 'room/' || r.community_id || '/' || r.id || '/' || new_id || '/' || stem || '.' || ext;
    insert into public.message_attachments (id, path, name, mime, size_bytes, width, height, uploader_id, community_id, room_id)
    values (new_id, file_path, shown, lower(p_mime), p_size,
            case when is_image then p_width end, case when is_image then p_height end, uid, r.community_id, r.id);
  else
    if not public.attachment_dm_can_post(p_conversation) then
      raise exception 'CR: You can''t send files in this conversation.' using errcode = 'check_violation';
    end if;
    if coalesce((select sum(size_bytes) from public.message_attachments where uploader_id = uid and conversation_id is not null), 0)
       + p_size > public.attachment_dm_cap_bytes() then
      raise exception 'CR: You''ve used your % MB for files in direct messages. Delete some messages with files to send more.',
        public.attachment_dm_cap_bytes() / 1048576 using errcode = 'check_violation';
    end if;
    file_path := 'dm/' || p_conversation || '/' || new_id || '/' || stem || '.' || ext;
    insert into public.message_attachments (id, path, name, mime, size_bytes, width, height, uploader_id, conversation_id)
    values (new_id, file_path, shown, lower(p_mime), p_size,
            case when is_image then p_width end, case when is_image then p_height end, uid, p_conversation);
  end if;
  return jsonb_build_object('id', new_id, 'path', file_path, 'name', shown);
end $$;

-- Remove one of your own unsent files (cancel, or the remove button in the composer). Its bytes are queued for removal;
-- remove them from Storage right after (you're allowed to).
create or replace function public.remove_attachment(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  gone text;
begin
  delete from public.message_attachments
    where id = p_id and uploader_id = (select auth.uid()) and message_id is null and dm_message_id is null
    returning path into gone;
  if gone is null then raise exception 'CR: That file was already sent or removed.'; end if;
  return gone;
end $$;

-- ───────────────────────── sending ─────────────────────────

-- Send a room message or thread reply with attachments: [{ "id": "<attachment id>", "alt": "optional description" }].
-- Security invoker: the insert goes through the messages policies and triggers like any other message. Returns the
-- message as the room event carries it (with its attachments).
create or replace function public.post_message(p_room uuid, p_body text, p_parent uuid default null, p_attachments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare
  m public.messages;
begin
  perform set_config('ctrlroom.attachments', coalesce(p_attachments, '[]'::jsonb)::text, true);
  insert into public.messages (room_id, author_id, parent_id, body)
    values (p_room, (select auth.uid()), p_parent, coalesce(p_body, ''))
    returning * into m;
  return public.message_payload(m);
end $$;

create or replace function public.post_dm(p_conv uuid, p_body text, p_attachments jsonb default '[]'::jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  m public.dm_messages;
begin
  perform set_config('ctrlroom.attachments', coalesce(p_attachments, '[]'::jsonb)::text, true);
  insert into public.dm_messages (conversation_id, author_id, body)
    values (p_conv, (select auth.uid()), coalesce(p_body, ''))
    returning * into m;
  return public.dm_message_payload(m);
end $$;

-- Internal: link the attachments passed to post_message / post_dm to the new message. Every attachment must be the
-- author's, unsent, from the last 24 hours, for this room or conversation, and uploaded (its Storage object exists,
-- with a size and type that match). Returns how many and their total bytes.
create or replace function public.link_attachments(p_author uuid, p_room uuid, p_conv uuid, p_message uuid, p_dm_message uuid)
returns table (n int, bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  raw text := nullif(current_setting('ctrlroom.attachments', true), '');
  items jsonb;
  it record;
  a public.message_attachments;
  obj public.message_attachments;
  obj_found boolean;
  obj_size bigint;
  obj_mime text;
  meta jsonb;
begin
  n := 0;
  bytes := 0;
  -- Used once: a later insert in the same transaction starts clean.
  perform set_config('ctrlroom.attachments', '', true);
  if raw is null then return next; return; end if;
  begin
    items := raw::jsonb;
  exception when others then
    raise exception 'attachments must be a JSON array';
  end;
  if jsonb_typeof(items) <> 'array' then raise exception 'attachments must be a JSON array'; end if;
  if jsonb_array_length(items) > 10 then
    raise exception 'CR: A message can have up to 10 files.' using errcode = 'check_violation';
  end if;
  for it in select value, ordinality from jsonb_array_elements(items) with ordinality loop
    a := null;
    if jsonb_typeof(it.value) = 'object' and (it.value ->> 'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into a from public.message_attachments where id = (it.value ->> 'id')::uuid for update;
    end if;
    if a.id is null or a.uploader_id <> p_author or a.message_id is not null or a.dm_message_id is not null
       or a.created_at <= now() - interval '24 hours'
       or (p_room is not null and a.room_id is distinct from p_room)
       or (p_conv is not null and a.conversation_id is distinct from p_conv) then
      raise exception 'CR: One of the files can''t be sent anymore. Remove it and try again.' using errcode = 'check_violation';
    end if;
    select true, o.metadata into obj_found, meta from storage.objects o where o.bucket_id = 'attachments' and o.name = a.path;
    if obj_found is null then
      raise exception 'CR: A file is still uploading. Wait for it to finish.' using errcode = 'check_violation';
    end if;
    obj_size := case when (meta ->> 'size') ~ '^[0-9]+$' then (meta ->> 'size')::bigint end;
    obj_mime := lower(nullif(split_part(coalesce(meta ->> 'mimetype', ''), ';', 1), ''));
    if obj_size is not null and (obj_size < 1 or obj_size > public.attachment_max_bytes()) then
      raise exception 'CR: Files can be up to 10 MB.' using errcode = 'check_violation';
    end if;
    if obj_mime is not null and obj_mime <> a.mime then
      raise exception 'CR: A file doesn''t match its type. Remove it and try again.' using errcode = 'check_violation';
    end if;
    update public.message_attachments
      set message_id = p_message, dm_message_id = p_dm_message, position = n,
          size_bytes = coalesce(obj_size, a.size_bytes),
          alt = case when a.mime like 'image/%' then nullif(left(btrim(coalesce(it.value ->> 'alt', '')), 300), '') end
      where id = a.id
      returning * into obj;
    n := n + 1;
    bytes := bytes + obj.size_bytes;
    obj_found := null;
  end loop;
  return next;
end $$;

-- Named to sort before messages_after_insert (triggers fire in name order), so the message event carries the files.
create or replace function public.messages_aa_attachments() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  got record;
begin
  select * into got from public.link_attachments(new.author_id, new.room_id, null, new.id, null);
  if got.n = 0 and char_length(new.body) = 0 then
    raise exception 'CR: Write a message or add a file.' using errcode = 'check_violation';
  end if;
  if got.bytes > 0 then
    perform public.meter((select owner_id from public.communities where id = new.community_id), new.community_id, 'attachment_bytes', got.bytes);
  end if;
  return null;
end $$;

create trigger messages_aa_attachments after insert on public.messages
  for each row execute function public.messages_aa_attachments();

create or replace function public.dm_messages_aa_attachments() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  got record;
begin
  select * into got from public.link_attachments(new.author_id, null, new.conversation_id, null, new.id);
  if got.n = 0 and char_length(new.body) = 0 then
    raise exception 'CR: Write a message or add a file.' using errcode = 'check_violation';
  end if;
  return null;
end $$;

create trigger dm_messages_aa_attachments after insert on public.dm_messages
  for each row execute function public.dm_messages_aa_attachments();

-- Editing a message down to nothing is only fine while it still has files.
create or replace function public.messages_body_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and char_length(new.body) = 0 then
    if tg_table_name = 'messages' and not exists (select 1 from public.message_attachments where message_id = new.id)
       or tg_table_name = 'dm_messages' and not exists (select 1 from public.message_attachments where dm_message_id = new.id) then
      raise exception 'CR: Write a message or add a file.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger messages_body_guard before update of body on public.messages
  for each row execute function public.messages_body_guard();
create trigger dm_messages_body_guard before update of body on public.dm_messages
  for each row execute function public.messages_body_guard();

-- Restated from 0011: DM events carry the message's attachments.
create or replace function public.dm_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grp boolean;
  author_name text;
  mem public.dm_members;
  payload jsonb := public.dm_message_payload(new);
begin
  update public.dm_conversations set last_message_at = new.created_at where id = new.conversation_id returning is_group into grp;
  select display_name into author_name from public.profiles where id = new.author_id;
  for mem in select * from public.dm_members where conversation_id = new.conversation_id and status <> 'left' loop
    -- Someone who blocked the author hears nothing about their messages.
    if mem.user_id <> new.author_id
       and exists (select 1 from public.blocks where blocker_id = mem.user_id and blocked_id = new.author_id) then
      continue;
    end if;
    perform public.emit('user:' || mem.user_id, 'dm', jsonb_build_object(
      'message', payload,
      'conversation_id', new.conversation_id,
      'is_group', grp,
      'status', mem.status,
      'ignored', mem.ignored_at is not null,
      'muted', mem.muted,
      'author', author_name));
  end loop;
  return null;
end $$;

create or replace function public.dm_messages_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  member_id uuid;
  payload jsonb := public.dm_message_payload(new);
begin
  for member_id in
    select m.user_id from public.dm_members m
    where m.conversation_id = new.conversation_id
      and (m.status <> 'left' or new.created_at <= m.left_at)
      and not exists (select 1 from public.blocks b where b.blocker_id = m.user_id and b.blocked_id = new.author_id and m.user_id <> new.author_id)
  loop
    perform public.emit('user:' || member_id, 'dm_update', jsonb_build_object('message', payload));
  end loop;
  return null;
end $$;

-- ───────────────────────── deleting ─────────────────────────

-- Deleting a message (delete_message / delete_dm_message set deleted_at) deletes its attachments.
create or replace function public.messages_drop_attachments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'messages' then
    delete from public.message_attachments where message_id = new.id;
  else
    delete from public.message_attachments where dm_message_id = new.id;
  end if;
  return null;
end $$;

create trigger messages_drop_attachments after update of deleted_at on public.messages
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.messages_drop_attachments();
create trigger dm_messages_drop_attachments after update of deleted_at on public.dm_messages
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.messages_drop_attachments();

-- Every attachment row that goes (however: a deleted message, a removed file, a deleted room, community or
-- conversation, the 24-hour cleanup) queues its bytes for removal.
create or replace function public.message_attachments_to_trash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.attachment_trash (path, uploader_id, community_id)
  values (old.path, old.uploader_id, old.community_id)
  on conflict (path) do nothing;
  return null;
end $$;

create trigger message_attachments_to_trash after delete on public.message_attachments
  for each row execute function public.message_attachments_to_trash();

-- ───────────────────────── cleanup (daily cron, service role) ─────────────────────────

-- Drops unsent attachments older than 24 hours, then returns up to p_limit paths whose bytes should be removed from
-- the attachments bucket (oldest first). The cron removes them with the Storage API and calls attachments_cleanup_done.
create or replace function public.attachments_cleanup(p_limit int default 500) returns table (path text)
language plpgsql security definer set search_path = public as $$
begin
  delete from public.message_attachments a
    where a.message_id is null and a.dm_message_id is null and a.created_at < now() - interval '24 hours';
  return query
    select t.path from public.attachment_trash t
    order by t.queued_at, t.path
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

-- The paths the cron removed from Storage. Returns how many were cleared from the queue.
create or replace function public.attachments_cleanup_done(p_paths text[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.attachment_trash where path = any(coalesce(p_paths, '{}'::text[]));
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── row-level security ─────────────────────────

alter table public.message_attachments enable row level security;
alter table public.attachment_trash enable row level security;

-- Attachments are read with the message they belong to; unsent ones only by their uploader. Writes go through the
-- functions above.
create policy message_attachments_select on public.message_attachments for select to authenticated
  using (
    (message_id is null and dm_message_id is null and uploader_id = (select auth.uid()))
    or (message_id is not null and exists (
          select 1 from public.messages m where m.id = message_id and m.deleted_at is null and public.is_member(m.community_id)))
    or (dm_message_id is not null and exists (
          select 1 from public.dm_messages d where d.id = dm_message_id and d.deleted_at is null
            and public.dm_can_read(d.conversation_id, d.created_at)))
  );

-- No policies on attachment_trash: only the functions and the service role touch it.

revoke all on public.message_attachments, public.attachment_trash from anon, authenticated;
grant select on public.message_attachments to authenticated;

-- Storage: the private bucket, through the checks above.
create policy attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_attachment(name));
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_upload_attachment(name, metadata));
create policy attachments_update on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and public.can_upload_attachment(name, null))
  with check (bucket_id = 'attachments' and public.can_upload_attachment(name, metadata));
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.can_delete_attachment(name));

-- ───────────────────────── privileges ─────────────────────────

-- New functions are executable by PUBLIC by default; open only what signed-in people (and the storage policies, which
-- run as them) call. message_payload keeps its 0001 grant.
revoke execute on function
  public.attachment_ext_mime(text),
  public.attachment_ext(text),
  public.attachment_max_bytes(),
  public.attachment_dm_cap_bytes(),
  public.attachment_dm_can_post(uuid),
  public.attachment_room_can_post(uuid),
  public.can_upload_attachment(text, jsonb),
  public.can_delete_attachment(text),
  public.can_read_attachment(text),
  public.attachments_json(uuid, uuid),
  public.dm_message_payload(public.dm_messages),
  public.create_attachment(uuid, uuid, text, text, bigint, int, int),
  public.remove_attachment(uuid),
  public.post_message(uuid, text, uuid, jsonb),
  public.post_dm(uuid, text, jsonb),
  public.link_attachments(uuid, uuid, uuid, uuid, uuid),
  public.messages_aa_attachments(),
  public.dm_messages_aa_attachments(),
  public.messages_body_guard(),
  public.messages_drop_attachments(),
  public.message_attachments_to_trash(),
  public.attachments_cleanup(int),
  public.attachments_cleanup_done(text[])
from public, anon, authenticated;

grant execute on function
  public.attachment_ext_mime(text),
  public.attachment_ext(text),
  public.attachment_max_bytes(),
  public.can_upload_attachment(text, jsonb),
  public.can_delete_attachment(text),
  public.can_read_attachment(text),
  public.attachments_json(uuid, uuid),
  public.dm_message_payload(public.dm_messages),
  public.create_attachment(uuid, uuid, text, text, bigint, int, int),
  public.remove_attachment(uuid),
  public.post_message(uuid, text, uuid, jsonb),
  public.post_dm(uuid, text, jsonb)
to authenticated;

grant execute on function public.attachments_cleanup(int), public.attachments_cleanup_done(text[]) to service_role;
