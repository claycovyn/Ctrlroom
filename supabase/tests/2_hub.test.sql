-- Feed, points, classroom, calendar and notifications (0002_community_hub.sql).
\set QUIET on
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000101', 'olive@example.com', '{"username":"olive"}'),
  ('00000000-0000-0000-0000-000000000102', 'max@example.com', '{"username":"max"}'),
  ('00000000-0000-0000-0000-000000000103', 'nia@example.com', '{"username":"nia"}'),
  ('00000000-0000-0000-0000-000000000104', 'zed@example.com', '{"username":"zed"}');
set role authenticated;

-- ── olive starts a community; it comes with feed categories
select tests.login('00000000-0000-0000-0000-000000000101');
select id as hub from public.create_community('Hub', 'hub-crew') \gset
select tests.ok((select count(*) from public.post_categories where community_id = :'hub') = 4, 'default categories');
select id as questions from public.post_categories where community_id = :'hub' and name = 'Questions' \gset
select id as general_cat from public.post_categories where community_id = :'hub' and name = 'General' \gset
select id as announce_cat from public.post_categories where community_id = :'hub' and name = 'Announcements' \gset
select id as lounge from public.rooms where community_id = :'hub' and slug = 'lounge' \gset
insert into public.invites (community_id, created_by) values (:'hub', '00000000-0000-0000-0000-000000000101') returning code as invite \gset

select tests.login('00000000-0000-0000-0000-000000000102');
select public.join_with_invite(:'invite');
select tests.login('00000000-0000-0000-0000-000000000103');
select public.join_with_invite(:'invite');

-- ── posts
select tests.login('00000000-0000-0000-0000-000000000102');
insert into public.posts (community_id, category_id, author_id, title, body, pinned, like_count)
  values (:'hub', :'questions', '00000000-0000-0000-0000-000000000102', '  How do I start? ', 'Any tips @olive?', true, 99)
  returning id as q_post \gset
select tests.ok((select not pinned and like_count = 0 and title = 'How do I start?' from public.posts where id = :'q_post'), 'client can''t pin or set counts');
select tests.ok(tests.throws(format($$ insert into public.posts (community_id, category_id, author_id, title) values (%L, %L, %L, 'x') $$,
  :'hub', :'announce_cat', '00000000-0000-0000-0000-000000000102')), 'members can''t post in mod-only categories');
select tests.ok(tests.throws($$ update public.posts set like_count = 5 $$), 'can''t write post counters');
select tests.ok(tests.throws(format('select public.pin_post(%L, true)', :'q_post')), 'members can''t pin');
select tests.ok(tests.throws(format($$ insert into public.post_likes (post_id, user_id) values (%L, '00000000-0000-0000-0000-000000000102') $$, :'q_post')), 'can''t like your own post');

-- outsider sees nothing and can't post
select tests.login('00000000-0000-0000-0000-000000000104');
select tests.ok((select count(*) from public.posts) = 0, 'posts hidden from outsiders');
select tests.ok(tests.throws(format($$ insert into public.posts (community_id, author_id, title) values (%L, '00000000-0000-0000-0000-000000000104', 'spam') $$, :'hub')), 'outsiders can''t post');
select tests.ok(not public.can_use_topic('post:' || :'q_post'), 'outsiders can''t subscribe to a post');
select tests.ok((select count(*) from public.events) = 0 and (select count(*) from public.courses) = 0, 'outsiders see no events or courses');

-- ── likes and the daily cap
select tests.login('00000000-0000-0000-0000-000000000101');
select tests.ok(public.can_use_topic('post:' || :'q_post'), 'members can subscribe to a post');
insert into public.post_likes (post_id, user_id) values (:'q_post', '00000000-0000-0000-0000-000000000101');
delete from public.post_likes where post_id = :'q_post';
insert into public.post_likes (post_id, user_id) values (:'q_post', '00000000-0000-0000-0000-000000000101');
select public.pin_post(:'q_post', true);
select tests.login('00000000-0000-0000-0000-000000000103');
insert into public.post_likes (post_id, user_id) values (:'q_post', '00000000-0000-0000-0000-000000000103');
reset role;
select tests.ok((select like_count = 2 and pinned from public.posts where id = :'q_post'), 'like count + pin');
select tests.ok((select points from public.community_members where community_id = :'hub' and user_id = '00000000-0000-0000-0000-000000000102') = 2,
  'like/unlike/relike from one person = 1 point');
select tests.ok(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000101' and kind = 'mention'), 'post mention notifies');
set role authenticated;

-- ── comments, replies, notifications
select tests.login('00000000-0000-0000-0000-000000000103');
insert into public.post_comments (post_id, author_id, body) values (:'q_post', '00000000-0000-0000-0000-000000000103', 'Start small.')
  returning id as nia_comment \gset
select tests.login('00000000-0000-0000-0000-000000000101');
insert into public.post_comments (post_id, author_id, body, parent_id) values (:'q_post', '00000000-0000-0000-0000-000000000101', 'Agreed', :'nia_comment')
  returning id as olive_reply \gset
insert into public.post_comments (post_id, author_id, body, parent_id) values (:'q_post', '00000000-0000-0000-0000-000000000101', 'Deep', :'olive_reply')
  returning id as deep_reply \gset
select tests.ok((select parent_id from public.post_comments where id = :'deep_reply') = :'nia_comment'::uuid, 'replies flatten to one level');
insert into public.comment_likes (comment_id, user_id) values (:'nia_comment', '00000000-0000-0000-0000-000000000101');
select tests.login('00000000-0000-0000-0000-000000000102');
insert into public.comment_likes (comment_id, user_id) values (:'nia_comment', '00000000-0000-0000-0000-000000000102');
select tests.ok((select count(*) from public.notifications where kind = 'comment') = 3, 'post author notified of each comment');
select tests.ok((select count(*) from public.notifications where user_id <> '00000000-0000-0000-0000-000000000102') = 0, 'only your own notifications');
select tests.ok(tests.throws(format($$ update public.post_comments set like_count = 9 where id = %L $$, :'nia_comment')), 'can''t write comment counters');

-- ── answers
select tests.login('00000000-0000-0000-0000-000000000103');
select tests.ok(tests.throws(format('select public.mark_answer(%L)', :'nia_comment')), 'only the asker marks the answer');
select tests.login('00000000-0000-0000-0000-000000000102');
select public.mark_answer(:'nia_comment');
select public.mark_answer(:'nia_comment');
insert into public.posts (community_id, category_id, author_id, title) values (:'hub', :'general_cat', '00000000-0000-0000-0000-000000000102', 'Hello')
  returning id as g_post \gset
select tests.login('00000000-0000-0000-0000-000000000103');
insert into public.post_comments (post_id, author_id, body) values (:'g_post', '00000000-0000-0000-0000-000000000103', 'hi') returning id as g_comment \gset
select tests.login('00000000-0000-0000-0000-000000000102');
select tests.ok(tests.throws(format('select public.mark_answer(%L)', :'g_comment')), 'answers only in question categories');
reset role;
select tests.ok((select answer_comment_id from public.posts where id = :'q_post') = :'nia_comment'::uuid, 'answer stored');
select tests.ok((select points from public.community_members where community_id = :'hub' and user_id = '00000000-0000-0000-0000-000000000103') = 7,
  'nia: 2 like points + 5 for the answer, paid once');
select tests.ok(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000103' and kind = 'reply'), 'reply notifies');
select tests.ok(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000103' and kind = 'answer'), 'answer notifies');
set role authenticated;

-- moderation
select tests.login('00000000-0000-0000-0000-000000000103');
select tests.ok(tests.throws(format('select public.delete_post(%L)', :'q_post')), 'members can''t delete others'' posts');
select tests.login('00000000-0000-0000-0000-000000000101');
select public.delete_comment(:'g_comment');
select tests.ok((select comment_count from public.posts where id = :'g_post') = 0, 'deleting a comment updates the count');

-- ── classroom
select tests.login('00000000-0000-0000-0000-000000000102');
select tests.ok(tests.throws(format($$ insert into public.courses (community_id, title, created_by) values (%L, 'Mine', '00000000-0000-0000-0000-000000000102') $$, :'hub')), 'members can''t create courses');
select tests.login('00000000-0000-0000-0000-000000000101');
insert into public.courses (community_id, title, created_by, unlock_level) values (:'hub', 'Start here', '00000000-0000-0000-0000-000000000101', 2)
  returning id as course \gset
insert into public.course_modules (course_id, title) values (:'course', 'Week 1') returning id as module \gset
insert into public.lessons (course_id, module_id, title, position) values (:'course', :'module', 'Welcome', 0) returning id as lesson1 \gset
insert into public.lessons (course_id, module_id, title, position, drip_days) values (:'course', :'module', 'Day three', 1, 3) returning id as lesson2 \gset
insert into public.lesson_content (lesson_id, body, video_url) values (:'lesson1', 'Hi!', 'https://youtu.be/abc'), (:'lesson2', 'Later', null);
select tests.ok((select community_id from public.lessons where id = :'lesson1') = :'hub'::uuid, 'lesson community set from course');

select tests.login('00000000-0000-0000-0000-000000000102');
select tests.ok((select count(*) from public.courses) = 0, 'drafts are hidden');
select tests.login('00000000-0000-0000-0000-000000000101');
update public.courses set published = true where id = :'course';

select tests.login('00000000-0000-0000-0000-000000000102');
select tests.ok((select locked from public.course_overview(:'hub')), 'level 1 member sees the course locked');
select tests.ok((select count(*) from public.lessons where course_id = :'course') = 2, 'locked lesson titles still listed');
select tests.ok((select count(*) from public.lesson_content) = 0, 'locked lesson content hidden');
select tests.ok(tests.throws(format('select public.complete_lesson(%L)', :'lesson1')), 'can''t complete a locked lesson');

select tests.login('00000000-0000-0000-0000-000000000103');
select tests.ok(not (select locked from public.course_overview(:'hub')), 'level 2 member unlocks it');
select tests.ok((select count(*) from public.lesson_content) = 1, 'dripped lesson stays closed');
select tests.ok((select locked from public.course_lessons(:'course') where id = :'lesson2'), 'drip shows as locked');
select public.complete_lesson(:'lesson1');
select public.complete_lesson(:'lesson1', false);
select public.complete_lesson(:'lesson1');
select tests.ok((select done_count from public.course_overview(:'hub')) = 1, 'progress tracked');
select tests.ok(tests.throws(format($$ insert into public.lesson_progress (lesson_id, user_id, course_id) values (%L, '00000000-0000-0000-0000-000000000103', %L) $$, :'lesson2', :'course')), 'can''t fake progress');
reset role;
select tests.ok((select points from public.community_members where community_id = :'hub' and user_id = '00000000-0000-0000-0000-000000000103') = 8,
  'one point per lesson, once');
set role authenticated;

-- ── leaderboard
select tests.login('00000000-0000-0000-0000-000000000102');
select tests.ok((select user_id from public.leaderboard(:'hub', '7d') limit 1) = '00000000-0000-0000-0000-000000000103', 'leaderboard order');
select tests.ok((select count(*) from public.leaderboard(:'hub', 'all')) = 2, 'people with no points are left off');
select tests.ok((public.my_standing(:'hub') ->> 'next_level_at')::int = 5, 'points to next level');
select tests.ok(tests.throws($$ update public.community_members set points = 99999 $$), 'can''t edit your own points');

-- ── calendar
select tests.ok(tests.throws(format($$ insert into public.events (community_id, title, starts_at, ends_at, created_by)
  values (%L, 'x', now(), now() + interval '1 hour', '00000000-0000-0000-0000-000000000102') $$, :'hub')), 'members can''t create events');
select tests.login('00000000-0000-0000-0000-000000000101');
insert into public.events (community_id, title, starts_at, ends_at, room_id, created_by)
  values (:'hub', 'Office hours', now() + interval '1 day', now() + interval '1 day 1 hour', :'lounge', '00000000-0000-0000-0000-000000000101')
  returning id as event \gset
select tests.ok(tests.throws(format($$ insert into public.events (community_id, title, starts_at, ends_at, created_by)
  values (%L, 'bad', now(), now() - interval '1 hour', '00000000-0000-0000-0000-000000000101') $$, :'hub')), 'event must end after it starts');
select tests.login('00000000-0000-0000-0000-000000000102');
insert into public.event_rsvps (event_id, user_id, status) values (:'event', '00000000-0000-0000-0000-000000000102', 'going');
select tests.ok(tests.throws(format($$ insert into public.event_rsvps (event_id, user_id, status) values (%L, '00000000-0000-0000-0000-000000000103', 'going') $$, :'event')), 'can''t RSVP for someone else');

-- ── notifications read state
select tests.ok((select count(*) from public.notifications where read_at is null) > 0, 'unread notifications');
select public.mark_notifications_read(:'hub');
select tests.ok((select count(*) from public.notifications where read_at is null) = 0, 'mark read');
select tests.ok((select count(*) from public.search_posts(:'hub', 'start')) = 1, 'post search');
reset role;
\echo all hub tests passed
