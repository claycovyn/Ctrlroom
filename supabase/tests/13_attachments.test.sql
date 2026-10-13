-- Files and images in chat, for 0013_attachments.sql: the private bucket, reserving, uploading, reading, sending,
-- limits, takedowns, DM rules (requests, blocks, leaving), deleting, the 24-hour cleanup and function grants.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1300000-0000-0000-0000-00000000000a', 'own13@example.com', '{"username":"own13"}'),
  ('d1300000-0000-0000-0000-00000000000b', 'mod13@example.com', '{"username":"mod13"}'),
  ('d1300000-0000-0000-0000-00000000000c', 'mem13@example.com', '{"username":"mem13"}'),
  ('d1300000-0000-0000-0000-00000000000d', 'two13@example.com', '{"username":"two13"}'),
  ('d1300000-0000-0000-0000-00000000000e', 'out13@example.com', '{"username":"out13"}'),
  ('d1300000-0000-0000-0000-00000000000f', 'new13@example.com', '{"username":"new13"}');
\set own d1300000-0000-0000-0000-00000000000a
\set mod d1300000-0000-0000-0000-00000000000b
\set mem d1300000-0000-0000-0000-00000000000c
\set two d1300000-0000-0000-0000-00000000000d
\set out d1300000-0000-0000-0000-00000000000e
\set new d1300000-0000-0000-0000-00000000000f
\set c d1310000-0000-0000-0000-000000000001
\set other d1310000-0000-0000-0000-000000000002
\set r d1320000-0000-0000-0000-000000000001
\set r2 d1320000-0000-0000-0000-000000000002
\set ro d1320000-0000-0000-0000-000000000003

insert into public.communities (id, slug, name, owner_id) values
  (:'c', 'files-test', 'Files test', :'own'),
  (:'other', 'files-other', 'Files other', :'out');
insert into public.community_members (community_id, user_id, role) values
  (:'c', :'own', 'owner'), (:'c', :'mod', 'mod'), (:'c', :'mem', 'member'), (:'c', :'two', 'member'),
  (:'other', :'out', 'owner');
insert into public.rooms (id, community_id, slug, name) values
  (:'r', :'c', 'files', 'files'), (:'r2', :'c', 'more-files', 'more-files'), (:'ro', :'other', 'theirs', 'theirs');

create temp table t_ids (k text primary key, v text);
grant all on t_ids to authenticated, service_role;
create function tests.v(p text) returns text language sql stable as $$ select v from t_ids where k = p $$;
create function tests.id(p text) returns uuid language sql stable as $$ select (v::jsonb ->> 'id')::uuid from t_ids where k = p $$;
create function tests.path(p text) returns text language sql stable as $$ select v::jsonb ->> 'path' from t_ids where k = p $$;
-- Reserve in a room / conversation as the caller and remember the result.
create function tests.res_room(k text, p_room uuid, p_name text, p_mime text, p_size bigint) returns void language sql as $$
  insert into t_ids values (k, public.create_attachment(p_room, null, p_name, p_mime, p_size, 800, 600)::text)
$$;
create function tests.res_dm(k text, p_conv uuid, p_name text, p_mime text, p_size bigint) returns void language sql as $$
  insert into t_ids values (k, public.create_attachment(null, p_conv, p_name, p_mime, p_size)::text)
$$;
-- "Upload": what Storage does when the browser sends the file (an insert under the caller's policies).
create function tests.upload(p_path text, p_size bigint default 1000, p_mime text default null) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('attachments', p_path, case when p_mime is null then null else jsonb_build_object('size', p_size, 'mimetype', p_mime) end)
$$;
create function tests.files(p_path text) returns int language sql stable as $$
  select count(*)::int from storage.objects where bucket_id = 'attachments' and name = p_path
$$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- ── the bucket
select tests.ok((select not public and file_size_limit = 10485760 from storage.buckets where id = 'attachments'),
  'attachments bucket is private, 10 MB');
select tests.ok((select allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
                   'text/plain', 'text/markdown', 'text/csv', 'application/zip', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
                   'video/mp4', 'video/webm',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
                 and not allowed_mime_types && array['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/javascript']
                 from storage.buckets where id = 'attachments'), 'bucket allows the listed types and never SVG or HTML');

set role authenticated;

-- ── reserving: members of the room's community
select tests.login(:'mem');
select tests.res_room('img', :'r', 'Screen shot 2026/10 ü.png', 'image/png', 200000);
select tests.ok(tests.path('img') = 'room/' || :'c' || '/' || :'r' || '/' || tests.id('img') || '/Screen shot 202610.png',
  'the database picks the path, with a safe file name');
select tests.ok((select name = 'Screen shot 202610 ü.png' and width = 800 and height = 600 and message_id is null
                 from public.message_attachments where id = tests.id('img')), 'the shown name keeps the original (minus slashes)');
select tests.res_room('pdf', :'r', 'notes.PDF', 'application/pdf', 5000);
select tests.ok((select width is null and path like '%/notes.pdf' from public.message_attachments where id = tests.id('pdf')),
  'no image size for files, extension lower-cased');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.svg', 'image/svg+xml', 10) $$, :'r')), 'SVG refused');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.html', 'text/html', 10) $$, :'r')), 'HTML refused');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.htm', 'text/plain', 10) $$, :'r')), 'HTML named as text refused');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.png', 'application/pdf', 10) $$, :'r')),
  'type must match the extension');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'noext', 'text/plain', 10) $$, :'r')), 'a file needs an extension');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'big.zip', 'application/zip', 10485761) $$, :'r')),
  'over 10 MB refused');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'empty.txt', 'text/plain', 0) $$, :'r')), 'empty refused');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.png', 'image/png', 10) $$, :'ro')),
  'cannot reserve in another community''s room');
select tests.ok(tests.throws(format($$ select public.create_attachment(%L, %L, 'a.png', 'image/png', 10) $$, :'r', :'r')),
  'exactly one of room or conversation');
select tests.login(:'out');
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.png', 'image/png', 10) $$, :'r')), 'non-member cannot reserve');
reset role;
set role anon;
select tests.ok(tests.throws(format($$ select public.create_attachment(%L, null, 'a.png', 'image/png', 10) $$, :'r')),
  'signed out cannot reserve');
reset role;
set role authenticated;

-- ── uploading: only to your own reserved path
select tests.login(:'two');
select tests.ok(tests.throws(format($$ select tests.upload(%L) $$, tests.path('img'))), 'another member cannot upload to your path');
select tests.ok(tests.throws(format($$ select tests.upload(%L) $$, 'room/' || :'c' || '/' || :'r' || '/' || gen_random_uuid() || '/x.png')),
  'cannot upload to a path nobody reserved');
select tests.login(:'mem');
select tests.ok(tests.throws(format($$ select tests.upload(%L, 10485761, 'image/png') $$, tests.path('img'))),
  'Storage metadata over 10 MB refused by the policy');
select tests.ok(tests.throws(format($$ select tests.upload(%L, 1000, 'text/html') $$, tests.path('img'))),
  'Storage metadata of another type refused by the policy');
select tests.upload(tests.path('img'), 190000, 'image/png');
select tests.upload(tests.path('pdf'));
reset role;
select tests.ok(tests.files(tests.path('img')) = 1 and tests.files(tests.path('pdf')) = 1, 'the uploader uploads to the reserved paths');
set role authenticated;
select tests.ok(tests.files(tests.path('img')) = 1, 'the uploader reads their unsent file');
select tests.login(:'two');
select tests.ok(tests.files(tests.path('img')) = 0, 'other members do not see an unsent file');
select tests.ok((select count(*) = 0 from public.message_attachments where id = tests.id('img')), '... or its row');

-- ── sending
select tests.login(:'mem');
select tests.ok(tests.throws(format($$ select public.post_message(%L, '', null, '[]') $$, :'r')), 'an empty message without files is refused');
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'hi', null, %L) $$, :'r2',
  jsonb_build_array(jsonb_build_object('id', tests.id('img'))))), 'a file reserved for another room cannot be sent here');
insert into t_ids select 'msg1', public.post_message(:'r', '', null,
  jsonb_build_array(jsonb_build_object('id', tests.id('pdf')), jsonb_build_object('id', tests.id('img'), 'alt', '  The new sidebar  ')))::text;
select tests.ok((select jsonb_array_length(v::jsonb -> 'attachments') = 2
                   and v::jsonb -> 'attachments' -> 0 ->> 'name' = 'notes.PDF'
                   and v::jsonb -> 'attachments' -> 1 ->> 'alt' = 'The new sidebar'
                   and v::jsonb -> 'attachments' -> 0 ->> 'alt' is null
                   and v::jsonb ->> 'body' = '' from t_ids where k = 'msg1'),
  'a message with only files is sent, in order, with the image description');
select tests.ok((select size_bytes = 190000 from public.message_attachments where id = tests.id('img')),
  'the size comes from Storage when it says');
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'again', null, %L) $$, :'r',
  jsonb_build_array(jsonb_build_object('id', tests.id('img'))))), 'a sent file cannot be attached again');
select tests.ok(tests.throws(format($$ select tests.upload(%L) $$, tests.path('img') || 'x')), 'no uploads next to a sent file');
update storage.objects set metadata = '{"size": 5}' where name = tests.path('pdf');
reset role;
select tests.ok((select metadata is null from storage.objects where name = tests.path('pdf')), 'a sent file cannot be overwritten');
set role authenticated;
select tests.login(:'mem');
reset role;
select tests.ok((select count(*) = 1 from realtime.messages where topic = 'room:' || :'r' and event = 'message'
                   and jsonb_array_length(payload -> 'attachments') = 2), 'the room event carries the attachments');
select tests.ok((select count = 195000 from public.usage_daily where owner_id = :'own' and community_id = :'c' and metric = 'attachment_bytes'),
  'attached bytes are recorded for the community owner');
set role authenticated;

-- a file still uploading, someone else's file, more than ten
select tests.res_room('slow', :'r', 'slow.txt', 'text/plain', 10);
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'wait', null, %L) $$, :'r',
  jsonb_build_array(jsonb_build_object('id', tests.id('slow'))))), 'a file that is not uploaded yet cannot be sent');
select tests.upload(tests.path('slow'));
reset role;
update storage.objects set metadata = jsonb_build_object('size', 10, 'mimetype', 'text/csv') where name = tests.path('slow');
set role authenticated;
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'typed', null, %L) $$, :'r',
  jsonb_build_array(jsonb_build_object('id', tests.id('slow'))))), 'a file whose stored type does not match cannot be sent');
select tests.res_room('theirs', :'r', 'theirs.txt', 'text/plain', 10);
select tests.upload(tests.path('theirs'));
select tests.login(:'two');
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'mine?', null, %L) $$, :'r',
  jsonb_build_array(jsonb_build_object('id', tests.id('theirs'))))), 'nobody can send someone else''s file');
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'bad', null, '{"id": 1}') $$, :'r')), 'attachments must be a list');

-- a thread reply with a file; editing a file-only message to empty is fine, an empty text-only message is not
select tests.login(:'mem');
select tests.res_room('reply', :'r', 'reply.gif', 'image/gif', 300);
select tests.upload(tests.path('reply'));
select public.post_message(:'r', 'see this', (select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1'),
  jsonb_build_array(jsonb_build_object('id', tests.id('reply'))));
select tests.ok((select m.parent_id is not null from public.message_attachments a join public.messages m on m.id = a.message_id
                 where a.id = tests.id('reply')), 'thread replies take files');
update public.messages set body = 'now with words' where id = (select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1');
update public.messages set body = '' where id = (select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1');
select tests.ok((select body = '' from public.messages where id = (select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1')),
  'a message with files can be edited down to no text');
select public.post_message(:'r', 'just text');
select tests.ok(tests.throws($$ update public.messages set body = '' where body = 'just text' $$), 'a message without files needs text');

-- ── reading: members read, others don't
select tests.login(:'two');
select tests.ok(tests.files(tests.path('img')) = 1 and tests.files(tests.path('pdf')) = 1, 'members read sent files');
select tests.ok((select count(*) = 2 from public.message_attachments
                 where message_id = (select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1')), 'members read the attachment rows');
select tests.login(:'out');
select tests.ok(tests.files(tests.path('img')) = 0, 'non-members cannot read the file');
select tests.ok((select count(*) = 0 from public.message_attachments where community_id = :'c'), '... or the rows');
reset role;
set role anon;
select tests.ok((select count(*) = 0 from storage.objects where bucket_id = 'attachments'), 'signed out reads nothing');
reset role;
set role authenticated;

-- ── deleting a message deletes its files; the uploader or a mod removes the bytes
select tests.login(:'two');
delete from storage.objects where name = tests.path('img');
reset role;
select tests.ok(tests.files(tests.path('img')) = 1, 'a member cannot delete someone else''s file');
set role authenticated;
select tests.login(:'mem');
delete from storage.objects where name = tests.path('img');
reset role;
select tests.ok(tests.files(tests.path('img')) = 1, 'even the uploader cannot pull a file out from under a sent message');
set role authenticated;
select tests.login(:'mod');
select public.delete_message((select (v::jsonb ->> 'id')::uuid from t_ids where k = 'msg1'));
reset role;
select tests.ok((select count(*) = 0 from public.message_attachments where id in (tests.id('img'), tests.id('pdf'))),
  'deleting the message deletes its attachments');
select tests.ok((select count(*) = 2 from public.attachment_trash where path in (tests.path('img'), tests.path('pdf'))),
  'and queues their bytes for removal');
select tests.ok((select jsonb_array_length(payload -> 'attachments') = 0 from realtime.messages
                 where topic = 'room:' || :'r' and event = 'message_update' and payload ->> 'deleted_at' is not null
                 order by id desc limit 1), 'the delete event carries no attachments');
set role authenticated;
select tests.login(:'two');
select tests.ok(tests.files(tests.path('img')) = 0, 'members can no longer read the deleted file');
delete from storage.objects where name = tests.path('img');
reset role;
select tests.ok(tests.files(tests.path('img')) = 1, 'a member cannot remove the bytes');
set role authenticated;
select tests.login(:'mod');
delete from storage.objects where name = tests.path('img');
select tests.login(:'mem');
delete from storage.objects where name = tests.path('pdf');
reset role;
select tests.ok(tests.files(tests.path('img')) = 0 and tests.files(tests.path('pdf')) = 0, 'a mod and the uploader remove the bytes');
set role authenticated;

-- ── removing an unsent file
select tests.login(:'two');
select tests.ok(tests.throws(format($$ select public.remove_attachment(%L) $$, tests.id('slow'))), 'only the uploader removes an unsent file');
select tests.login(:'mem');
select tests.ok(public.remove_attachment(tests.id('slow')) = tests.path('slow'), 'the uploader removes it');
select tests.ok(tests.throws(format($$ select public.remove_attachment(%L) $$, tests.id('reply'))), 'a sent file cannot be removed this way');
delete from storage.objects where name = tests.path('slow');
reset role;
select tests.ok(tests.files(tests.path('slow')) = 0, 'and then its bytes');
set role authenticated;

-- ── takedown: no new files
select tests.login(:'mem');
select tests.res_room('late', :'r', 'late.png', 'image/png', 10);
reset role;
update public.communities set taken_down_at = now(), taken_down_reason = 'test' where id = :'c';
set role authenticated;
select tests.ok(tests.throws(format($$ select tests.res_room('x', %L, 'a.png', 'image/png', 10) $$, :'r')), 'no reserving while taken down');
select tests.ok(tests.throws(format($$ select tests.upload(%L) $$, tests.path('late'))), 'no uploads while taken down');
reset role;
update public.communities set taken_down_at = null, taken_down_reason = null where id = :'c';
set role authenticated;

-- ── limits per person: 30 unsent files
select tests.login(:'two');
select tests.res_room('p' || n, :'r', 'f' || n || '.txt', 'text/plain', 10) from generate_series(1, 30) as n;
select tests.ok(tests.throws(format($$ select tests.res_room('p31', %L, 'f31.txt', 'text/plain', 10) $$, :'r')),
  'at most 30 unsent files per person');
select tests.upload(tests.path('p' || n)) from generate_series(1, 11) as n;
select tests.ok(tests.throws(format($$ select public.post_message(%L, 'eleven', null, %L) $$, :'r',
  (select jsonb_agg(jsonb_build_object('id', tests.id('p' || n)) order by n) from generate_series(1, 11) as n))), 'up to 10 files per message');
select public.post_message(:'r', 'ten', null,
  (select jsonb_agg(jsonb_build_object('id', tests.id('p' || n)) order by n) from generate_series(1, 10) as n));
select tests.ok((select count(*) = 10 from public.message_attachments a join public.messages m on m.id = a.message_id where m.body = 'ten'),
  'ten is fine');

-- ── direct messages
reset role;
insert into public.community_members (community_id, user_id, role) values (:'c', :'new', 'member');
set role authenticated;
select tests.login(:'mem');
insert into t_ids values ('dm', public.start_dm(array[:'own']::uuid[], 'hi')::text);
select tests.login(:'own');
select tests.ok(tests.throws(format($$ select tests.res_dm('x', %L, 'a.png', 'image/png', 10) $$, tests.v('dm'))),
  'a request recipient cannot send files before accepting');
select public.accept_dm_request(tests.v('dm')::uuid);
select tests.res_dm('dmf', tests.v('dm')::uuid, 'plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 4000);
select tests.ok(tests.path('dmf') = 'dm/' || tests.v('dm') || '/' || tests.id('dmf') || '/plan.docx', 'DM files go under the conversation');
select tests.upload(tests.path('dmf'));
select public.post_dm(tests.v('dm')::uuid, 'the plan', jsonb_build_array(jsonb_build_object('id', tests.id('dmf'), 'alt', 'ignored')));
select tests.ok((select alt is null and dm_message_id is not null from public.message_attachments where id = tests.id('dmf')),
  'sent in a DM; descriptions are for images only');
reset role;
select tests.ok((select count(*) = 2 from realtime.messages where event = 'dm' and jsonb_array_length(payload -> 'message' -> 'attachments') = 1),
  'both members get the DM event with the attachment');
select tests.ok((select count(*) = 0 from public.usage_daily where metric = 'attachment_bytes' and owner_id <> :'own'),
  'DM files are not metered');
set role authenticated;
select tests.login(:'mem');
select tests.ok(tests.files(tests.path('dmf')) = 1, 'the other member reads it');
select tests.login(:'two');
select tests.ok(tests.files(tests.path('dmf')) = 0, 'people outside the conversation cannot (even in the same community)');
select tests.ok(tests.throws(format($$ select tests.res_dm('x', %L, 'a.png', 'image/png', 10) $$, tests.v('dm'))),
  'and cannot send files into it');
-- blocked 1:1
select tests.login(:'mem');
select public.block_user(:'own');
select tests.login(:'own');
select tests.ok(tests.throws(format($$ select tests.res_dm('x', %L, 'a.png', 'image/png', 10) $$, tests.v('dm'))),
  'no files in a 1:1 where either person blocked the other');
select tests.login(:'mem');
select public.unblock_user(:'own');

-- groups and leaving: you read what was sent before you left, nothing after
select tests.login(:'mem');
insert into t_ids values ('g', public.start_dm(array[:'own', :'new']::uuid[], 'group')::text);
select tests.login(:'new');
select public.accept_dm_request(tests.v('g')::uuid);
select tests.login(:'mem');
select tests.res_dm('before', tests.v('g')::uuid, 'before.png', 'image/png', 10);
select tests.upload(tests.path('before'));
select public.post_dm(tests.v('g')::uuid, '', jsonb_build_array(jsonb_build_object('id', tests.id('before'))));
select tests.login(:'new');
select public.leave_dm(tests.v('g')::uuid);
reset role;
update public.dm_messages set created_at = now() - interval '2 minutes' where conversation_id = tests.v('g')::uuid;
update public.dm_members set left_at = now() - interval '1 minute' where conversation_id = tests.v('g')::uuid and user_id = :'new';
set role authenticated;
select tests.login(:'mem');
select tests.res_dm('after', tests.v('g')::uuid, 'after.png', 'image/png', 10);
select tests.upload(tests.path('after'));
select public.post_dm(tests.v('g')::uuid, 'after', jsonb_build_array(jsonb_build_object('id', tests.id('after'))));
select tests.login(:'new');
select tests.ok(tests.files(tests.path('before')) = 1, 'someone who left reads files sent before they left');
select tests.ok(tests.files(tests.path('after')) = 0, '... but not files sent after');
select tests.ok(tests.throws(format($$ select tests.res_dm('x', %L, 'a.png', 'image/png', 10) $$, tests.v('g'))),
  'and cannot send files there');
select tests.login(:'own');
select tests.ok(tests.files(tests.path('after')) = 1, 'the other members read them');

-- deleting a DM: the author's files go, the author removes the bytes, nobody else can
select tests.login(:'own');
select tests.ok(tests.throws(format($$ select public.delete_dm_message(%L) $$,
  (select dm_message_id from public.message_attachments where id = tests.id('after')))), 'only the author deletes a DM');
select tests.login(:'mem');
select public.delete_dm_message((select dm_message_id from public.message_attachments where id = tests.id('after')));
reset role;
select tests.ok((select count(*) = 0 from public.message_attachments where id = tests.id('after'))
                and (select count(*) = 1 from public.attachment_trash where path = tests.path('after')), 'deleting a DM deletes its files');
set role authenticated;
select tests.login(:'own');
delete from storage.objects where name = tests.path('after');
reset role;
select tests.ok(tests.files(tests.path('after')) = 1, 'another member cannot remove the bytes');
set role authenticated;
select tests.login(:'mem');
delete from storage.objects where name = tests.path('after');
reset role;
select tests.ok(tests.files(tests.path('after')) = 0, 'the author removes them');

-- the per-person cap on DM files
set ctrlroom.dm_files_cap_mb = '1';
set role authenticated;
select tests.login(:'mem');
select tests.res_dm('cap1', tests.v('g')::uuid, 'a.zip', 'application/zip', 900000);
select tests.ok(tests.throws(format($$ select tests.res_dm('cap2', %L, 'b.zip', 'application/zip', 200000) $$, tests.v('g'))),
  'DM files stop at the per-person cap');
select public.remove_attachment(tests.id('cap1'));
select tests.res_dm('cap2', tests.v('g')::uuid, 'b.zip', 'application/zip', 200000);
reset role;
reset ctrlroom.dm_files_cap_mb;
select tests.ok(public.attachment_dm_cap_bytes() = 524288000, 'the default cap is 500 MB');

-- ── the 24-hour cleanup
update public.message_attachments set created_at = now() - interval '25 hours' where id = tests.id('cap2');
set role authenticated;
select tests.login(:'mem');
select tests.ok(tests.throws(format($$ select tests.upload(%L) $$, tests.path('cap2'))), 'an unsent file older than a day cannot be uploaded');
select tests.ok(tests.throws('select * from public.attachments_cleanup()'), 'signed-in people cannot run the cleanup');
select tests.ok(tests.throws($$ select public.attachments_cleanup_done(array['x']) $$), '... or clear the queue');
reset role;
set role service_role;
insert into t_ids select 'clean:' || path, path from public.attachments_cleanup(1000);
reset role;
select tests.ok((select count(*) = 0 from public.message_attachments where id = tests.id('cap2')), 'the cleanup drops unsent files older than a day');
select tests.ok(tests.v('clean:' || tests.path('cap2')) is not null and tests.v('clean:' || tests.path('img')) is not null,
  'and returns every path whose bytes should go');
select tests.ok(exists (select 1 from public.message_attachments where id = tests.id('reply')), 'sent files stay');
set role service_role;
select tests.ok(public.attachments_cleanup_done(array[tests.path('cap2'), tests.path('img')]) = 2, 'the cron clears what it removed');
reset role;
select tests.ok((select count(*) = 0 from public.attachment_trash where path in (tests.path('cap2'), tests.path('img'))), 'off the queue');

-- deleting a room queues its files too
delete from public.rooms where id = :'r';
select tests.ok((select count(*) = 1 from public.attachment_trash where path = tests.path('reply')), 'deleting a room queues its files');

-- ── privileges
select tests.ok(not has_function_privilege('authenticated', 'public.attachments_cleanup(int)', 'execute')
                and not has_function_privilege('anon', 'public.attachments_cleanup(int)', 'execute')
                and has_function_privilege('service_role', 'public.attachments_cleanup(int)', 'execute'), 'cleanup is service role only');
select tests.ok(not has_function_privilege('authenticated', 'public.link_attachments(uuid, uuid, uuid, uuid, uuid)', 'execute'),
  'linking only runs from the message triggers');
select tests.ok(not has_function_privilege('authenticated', 'public.attachment_dm_can_post(uuid)', 'execute')
                and not has_function_privilege('authenticated', 'public.messages_aa_attachments()', 'execute'), 'internal helpers are closed');
select tests.ok(not has_function_privilege('anon', 'public.create_attachment(uuid, uuid, text, text, bigint, int, int)', 'execute')
                and has_function_privilege('authenticated', 'public.post_message(uuid, text, uuid, jsonb)', 'execute'), 'people call these');
select tests.ok(not has_table_privilege('authenticated', 'public.message_attachments', 'insert')
                and not has_table_privilege('authenticated', 'public.message_attachments', 'update')
                and not has_table_privilege('authenticated', 'public.attachment_trash', 'select'), 'no direct writes, no trash reads');

rollback;
\echo all attachment tests passed
