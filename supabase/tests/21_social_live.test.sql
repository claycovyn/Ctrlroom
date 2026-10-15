-- The Feed, live and with media (0021_social_live.sql): photos and videos (reserve, upload, publish, read, limits,
-- cleanup), live events, activity, follower lists and grants.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2100000-0000-0000-0000-00000000000a', 'amy21@example.com', '{"username":"amy21","display_name":"Amy"}'),
  ('c2100000-0000-0000-0000-00000000000b', 'bo21@example.com', '{"username":"bo21","display_name":"Bo"}'),
  ('c2100000-0000-0000-0000-00000000000c', 'cy21@example.com', '{"username":"cy21","display_name":"Cy"}'),
  ('c2100000-0000-0000-0000-00000000000d', 'di21@example.com', '{"username":"di21","display_name":"Di"}');
\set a c2100000-0000-0000-0000-00000000000a
\set b c2100000-0000-0000-0000-00000000000b
\set c c2100000-0000-0000-0000-00000000000c
\set d c2100000-0000-0000-0000-00000000000d

create temp table t_ids (k text primary key, v uuid);
create temp table t_paths (k text primary key, v text);
grant all on t_ids, t_paths to authenticated;
create function tests.id(p text) returns uuid language sql stable as $$ select v from t_ids where k = p $$;
create function tests.path(p text) returns text language sql stable as $$ select v from t_paths where k = p $$;
-- Reserve a file and "upload" it (the Storage row the bucket would write), as the caller.
create function tests.media(p_key text, p_mime text default 'image/webp', p_size bigint default 1000) returns uuid language plpgsql as $$
declare
  r record;
begin
  select * into r from public.create_post_media(p_mime, p_size, 800, 600, 'a dog');
  insert into t_ids values (p_key, r.id);
  insert into t_paths values (p_key, r.path);
  insert into storage.objects (bucket_id, name, owner) values ('post-media', r.path, auth.uid());
  return r.id;
end $$;
create function tests.events(p_topic text, p_event text) returns int language sql stable as $$
  select count(*)::int from realtime.messages where topic = p_topic and event = p_event
$$;
grant execute on function tests.id(text), tests.path(text), tests.media(text, text, bigint), tests.events(text, text) to authenticated, anon;
-- The cleanup checks run as the cron's role.
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;
grant all on t_ids, t_paths to service_role;

set role authenticated;

-- ── photos and videos
select tests.login(:'a');
select tests.ok(tests.throws($$ select * from public.create_post_media('image/svg+xml', 100) $$), 'SVG is never accepted');
select tests.ok(tests.throws($$ select * from public.create_post_media('text/html', 100) $$), 'nor HTML');
select tests.ok(tests.throws($$ select * from public.create_post_media('image/png', 10485761) $$), 'photos up to 10 MB');
select tests.ok(not tests.throws($$ select * from public.create_post_media('video/mp4', 52428800) $$), 'videos up to 50 MB');
select tests.ok(tests.throws($$ select * from public.create_post_media('video/mp4', 52428801) $$), 'not more');
select tests.ok((select path like 'post/c2100000-0000-0000-0000-00000000000a/%/media.webp' from public.create_post_media('image/webp', 10)), 'the database picks the path, under your id, with the right extension');
reset role;
delete from public.post_media;
set role authenticated;
select tests.login(:'a');
select tests.media('p1');
select tests.media('v1', 'video/mp4', 5000);
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name, owner) values ('post-media', %L, auth.uid()) $$,
  replace(tests.path('p1'), 'media.webp', 'other.webp'))), 'uploads only to a reserved path');
select tests.login(:'b');
select tests.ok(tests.throws(format($$ insert into storage.objects (bucket_id, name, owner) values ('post-media', %L, auth.uid()) $$, tests.path('p1'))),
  'nobody uploads to someone else''s path');
select tests.ok(not public.can_read_post_media(tests.path('p1')), 'a pending file is only for its uploader');
select tests.login(:'a');
select tests.ok(public.can_read_post_media(tests.path('p1')), 'the uploader reads their pending file');

-- publish: text and media together; the order is kept
insert into t_ids values ('post', public.publish_post('look', null, null, array[tests.id('v1'), tests.id('p1')]));
select tests.ok((select jsonb_array_length(media) = 2 and media -> 0 ->> 'mime' = 'video/mp4' and media -> 1 ->> 'alt' = 'a dog'
                 from public.post_cards where id = tests.id('post')), 'the post has both files, in the order given');
select tests.media('p2');
insert into t_ids values ('photo-only', public.publish_post('', null, null, array[tests.id('p2')]));
set constraints all immediate;
select tests.ok((select body = '' from public.posts where id = tests.id('photo-only')), 'a post can be just a photo');
select tests.ok(tests.throws($$ select public.publish_post('  ') $$), 'but not empty');
select tests.ok(tests.throws($$ select public.publish_post('five', null, null, array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]) $$),
  'at most 4 files');
select tests.ok(tests.throws(format($$ select public.publish_post('reuse', null, null, array[%L::uuid]) $$, tests.id('p1'))), 'a posted file cannot be posted again');
select tests.ok(tests.throws($$ select * from public.create_post_media('image/png', 10) as r, lateral public.publish_post('not uploaded', null, null, array[r.id]) $$),
  'a file that never finished uploading is refused');
select tests.login(:'b');
select tests.ok(tests.throws(format($$ select public.attach_post_media(%L, array[%L::uuid]) $$, tests.id('post'), tests.id('p1'))), 'nobody attaches to someone else''s post');

-- reading: whoever can see the post
select tests.ok(public.can_read_post_media(tests.path('p1')), 'Bo reads the files of Amy''s public post');
select tests.ok((select count(*) from public.post_media where post_id = tests.id('post')) = 2, 'and their rows');
select tests.login(:'a');
select public.set_private_account(true);
select tests.login(:'b');
select tests.ok(not public.can_read_post_media(tests.path('p1')), 'private account: not for people who don''t follow her');
select tests.ok((select count(*) from public.post_media where post_id = tests.id('post')) = 0, 'not even the rows');
select tests.login(:'a');
select public.set_private_account(false);

-- ── live: posts:public for public posts, followers for a private account's, replies and likes to the author
select tests.login(:'c');
select tests.ok(public.can_use_topic('posts:public'), 'anyone signed in listens to posts:public');
select tests.login(null);
select tests.ok(not public.can_use_topic('posts:public'), 'without a session, no');
reset role;
select tests.ok(tests.events('posts:public', 'post') = 2, 'both of Amy''s public posts went out on posts:public');
set role authenticated;
select tests.login(:'c');
select public.follow_user(:'a');
select tests.login(:'a');
select public.set_private_account(true);
insert into t_ids values ('private', public.publish_post('for followers'));
reset role;
select tests.ok(tests.events('posts:public', 'post') = 2, 'a private account''s post is not on posts:public');
select tests.ok(tests.events('user:' || :'c', 'post') = 1, 'its followers hear about it');
select tests.ok(tests.events('user:' || :'b', 'post') = 0, 'nobody else');
set role authenticated;
select tests.login(:'a');
select public.set_private_account(false);
select tests.login(:'b');
insert into t_ids values ('reply', public.publish_post('nice dog', null, tests.id('post')));
insert into public.post_likes (post_id, user_id) values (tests.id('post'), :'b');
select tests.login(:'a');
insert into public.post_likes (post_id, user_id) values (tests.id('post'), :'a');
reset role;
select tests.ok(tests.events('user:' || :'a', 'post_reply') = 1, 'Amy hears about Bo''s reply');
select tests.ok(tests.events('user:' || :'a', 'post_like') = 1, 'and his like, not her own');
select tests.ok(tests.events('posts:public', 'post') = 2, 'replies are not new posts in the Feed');
set role authenticated;

-- ── activity
select tests.login(:'a');
select tests.ok((select array_agg(kind order by at desc, kind) from public.my_activity()) @> array['follow', 'like', 'reply'], 'Amy''s activity: Cy''s follow, Bo''s like and reply');
select tests.ok(public.my_activity_unseen() = 3, 'three she hasn''t seen');
select public.mark_activity_seen();
select tests.ok(public.my_activity_unseen() = 0, 'seen');
select tests.login(:'d');
select public.set_public_profile(false);
insert into public.post_likes (post_id, user_id) values (tests.id('post'), :'d');
select tests.login(:'a');
select tests.ok((select count(*) from public.my_activity() where actor_id = :'d') = 0, 'a like from a hidden profile Amy can''t see stays out of her activity');
select tests.login(:'b');
select tests.ok((select count(*) from public.my_activity()) = 0, 'Bo has none');
select tests.login(:'d');
select public.set_public_profile(true);
select public.set_private_account(true);
select tests.login(:'b');
select public.follow_user(:'d');
select tests.ok((select count(*) from public.my_activity()) = 0, 'a request still waiting is not activity for the one who asked');
select tests.login(:'d');
select public.answer_follow_request(:'b', true);
select tests.login(:'b');
select tests.ok((select kind from public.my_activity() where actor_id = :'d') = 'approved', 'Bo sees that Di approved his request');
select tests.ok(public.my_activity_unseen() = 1, 'and it counts as new');
reset role;
select tests.ok(tests.events('user:' || :'b', 'follow_approved') = 1, 'live, too');
set role authenticated;
select tests.login(:'d');
select public.set_private_account(false);
select public.set_public_profile(false);
select tests.login(:'b');
select public.unfollow_user(:'d');

-- ── follower lists
select tests.login(:'b');
select public.follow_user(:'a');
select tests.ok((select array_agg(username order by username) from public.profile_follows('amy21', 'followers')) = array['bo21', 'cy21'], 'Amy''s followers');
select tests.ok((select relation from public.profile_follows('amy21', 'followers') where username = 'bo21') = 'self', 'Bo sees himself in the list');
select tests.ok((select array_agg(username) from public.profile_follows('cy21', 'following')) = array['amy21'], 'who Cy follows');
select tests.login(:'a');
select public.set_private_account(true);
select tests.login(:'d');
select public.set_public_profile(true);
select tests.ok((select count(*) from public.profile_follows('amy21', 'followers')) = 0, 'a private account''s lists are only for its followers');
select tests.login(:'c');
select tests.ok((select count(*) from public.profile_follows('amy21', 'followers')) = 2, 'Cy follows her, so she sees them');
select tests.ok((select count(*) from public.profile_follows('amy21', 'nonsense')) = 0, 'only followers or following');

-- ── cleanup (the cron, as service_role)
select tests.login(:'a');
select tests.media('stale');
select public.delete_post(tests.id('photo-only'));
reset role;
update public.post_media set created_at = now() - interval '2 days' where id = tests.id('stale');
set role service_role;
select tests.ok((select array_agg(path order by path) from public.post_media_cleanup()) = (select array_agg(v order by v) from t_paths where k in ('stale', 'p2')),
  'the cron gets a stale pending file and the deleted post''s file, nothing else');
select public.post_media_cleanup_done(array[tests.path('stale'), tests.path('p2'), tests.path('p1')]);
reset role;
select tests.ok((select count(*) from public.post_media where id in (tests.id('stale'), tests.id('p2'))) = 0, 'their rows go once the bytes are removed');
select tests.ok((select count(*) from public.post_media where id = tests.id('p1')) = 1, 'a live post''s file is never dropped');

-- ── grants
set role authenticated;
select tests.login(:'a');
select tests.ok(tests.throws($$ select * from public.post_media_cleanup() $$), 'people cannot run the cleanup');
select tests.ok(tests.throws($$ update public.post_media set post_id = null $$) or (select count(*) from public.post_media where post_id is null) = 0, 'files are not changed directly');
reset role;
set role anon;
select tests.ok(tests.throws($$ select * from public.create_post_media('image/png', 10) $$), 'anon reserves nothing');
select tests.ok(tests.throws($$ select * from public.my_activity() $$), 'anon has no activity');
reset role;

\echo all social live tests passed
rollback;
