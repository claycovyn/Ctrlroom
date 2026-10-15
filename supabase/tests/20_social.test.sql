-- Posts and follows (0020_social.sql): the public profile is opt-in, private accounts, community posts, replies,
-- blocks, likes, edits, deletes, reports, the flood guard, the Feed's two scopes, profile_view and grants.
-- Runs in one transaction and rolls back, so the other test files start from a clean database.
\set QUIET on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2000000-0000-0000-0000-00000000000a', 'ann20@example.com', '{"username":"ann20","display_name":"Ann"}'),
  ('c2000000-0000-0000-0000-00000000000b', 'ben20@example.com', '{"username":"ben20","display_name":"Ben"}'),
  ('c2000000-0000-0000-0000-00000000000c', 'cat20@example.com', '{"username":"cat20","display_name":"Cat"}'),
  ('c2000000-0000-0000-0000-00000000000d', 'dan20@example.com', '{"username":"dan20","display_name":"Dan"}'),
  ('c2000000-0000-0000-0000-00000000000e', 'eli20@example.com', '{"username":"eli20","display_name":"Eli"}');
\set a c2000000-0000-0000-0000-00000000000a
\set b c2000000-0000-0000-0000-00000000000b
\set c c2000000-0000-0000-0000-00000000000c
\set d c2000000-0000-0000-0000-00000000000d
\set e c2000000-0000-0000-0000-00000000000e
\set pub c2100000-0000-0000-0000-000000000001
\set priv c2100000-0000-0000-0000-000000000002

-- pub: a public community with Ann (owner) and Dan (mod). priv: a private one with Ann. Ben, Cat and Eli share nothing.
insert into public.communities (id, slug, name, owner_id, is_public) values
  (:'pub', 'social-pub', 'Social pub', :'a', true),
  (:'priv', 'social-priv', 'Social priv', :'a', false);
insert into public.community_members (community_id, user_id, role) values
  (:'pub', :'a', 'owner'), (:'pub', :'d', 'mod'), (:'priv', :'a', 'owner');

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
create function tests.id(p text) returns uuid language sql stable as $$ select v from t_ids where k = p $$;
create function tests.post(p_body text, p_community uuid default null, p_reply uuid default null) returns uuid language sql as $$
  insert into public.posts (author_id, body, community_id, reply_to) values (auth.uid(), p_body, p_community, p_reply) returning id
$$;
create function tests.sees(p_post uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.post_cards where id = p_post)
$$;
-- A post with the commit-time checks run at once (posts_need_content is deferred to commit, 0021).
create function tests.post_now(p_body text) returns uuid language plpgsql as $$
declare
  pid uuid;
begin
  insert into public.posts (author_id, body) values (auth.uid(), p_body) returning id into pid;
  set constraints all immediate;
  return pid;
end $$;
grant execute on function tests.id(text), tests.post(text, uuid, uuid), tests.sees(uuid), tests.post_now(text) to authenticated, anon;

set role authenticated;

-- ── public by default; a hidden profile works as before 0020
select tests.login(:'b');
select tests.ok((select count(*) from public.profiles where id = :'a') = 1, 'Ben sees Ann''s profile: public by default');
select tests.login(:'a');
select public.set_public_profile(false);
select tests.login(:'b');
select tests.ok((select count(*) from public.profiles where id = :'a') = 0, 'with it off, Ben cannot see Ann (nothing shared)');
select tests.ok((select count(*) from public.profile_view('ann20')) = 0, 'profile_view says not found too');
select tests.ok(tests.throws($$ select public.follow_user('c2000000-0000-0000-0000-00000000000a') $$), 'Ben cannot follow a hidden profile');
select tests.login(:'a');
select tests.ok(tests.throws($$ select tests.post('hello') $$), 'Ann cannot post while her profile is hidden');
select public.set_public_profile(true);
insert into t_ids values ('hello', tests.post('  hello world  '));
select tests.ok((select body = 'hello world' and edited_at is null from public.posts where id = tests.id('hello')), 'posts are trimmed');
select tests.ok(tests.throws($$ select tests.post_now('   ') $$), 'an empty post is refused');
select tests.ok(tests.throws(format($$ select tests.post(%L) $$, repeat('x', 501))), 'a post over 500 characters is refused');
select tests.ok(tests.throws(format($$ insert into public.posts (author_id, body) values (%L, 'as Ben') $$, :'b')), 'nobody posts as someone else');

select tests.login(:'b');
select tests.ok((select count(*) from public.profiles where id = :'a') = 1, 'with it on, Ben sees Ann''s profile');
select tests.ok(tests.sees(tests.id('hello')), 'and her post');
select tests.ok((select relation = 'none' and can_see_posts and posts = 1 and not is_private from public.profile_view('ann20')), 'profile_view: not following, posts visible');
select tests.ok((select count(*) from public.feed_posts('everyone')) = 1, 'Everyone shows Ann''s post');
select tests.ok((select count(*) from public.feed_posts('following')) = 0, 'Following does not, until Ben follows her');
select tests.ok(public.follow_user(:'a') = 'active', 'following a public account is instant');
select tests.ok((select count(*) from public.feed_posts('following')) = 1, 'now Following shows it');
select tests.ok(public.follow_user(:'a') = 'active', 'following again is harmless');
select tests.ok(tests.throws(format($$ select public.follow_user(%L) $$, :'b')), 'nobody follows themselves');
select tests.ok(tests.throws($$ select public.follow_user('00000000-0000-4000-8000-00000000c7a1') $$), 'nobody follows the AI helpers');
reset role;
select tests.ok((select payload ->> 'follower_id' = 'c2000000-0000-0000-0000-00000000000b' and payload ->> 'status' = 'active'
                 from realtime.messages where topic = 'user:' || :'a' and event = 'follow' order by id desc limit 1), 'Ann hears about her new follower');
set role authenticated;

-- ── Ben hides his profile: Ann still sees him because he follows her
select tests.login(:'b');
select public.set_public_profile(false);
select tests.login(:'a');
select tests.ok((select count(*) from public.profiles where id = :'b') = 1, 'Ann sees Ben (he follows her)');
select tests.login(:'c');
select tests.ok((select count(*) from public.profiles where id = :'b') = 0, 'Cat does not see Ben');
select tests.ok((select followers = 1 from public.profile_view('ann20')), 'Ann has one follower');

-- ── private accounts: requests, approval, going public again
select tests.login(:'a');
select public.set_private_account(true);
select tests.login(:'c');
select tests.ok(not tests.sees(tests.id('hello')), 'Cat cannot see a private account''s posts');
select tests.ok((select is_private and not can_see_posts and posts is null from public.profile_view('ann20')), 'profile_view hides the count too');
select tests.ok(public.follow_user(:'a') = 'pending', 'following a private account sends a request');
select tests.ok(not tests.sees(tests.id('hello')), 'a request is not enough');
select tests.login(:'b');
select tests.ok(tests.sees(tests.id('hello')), 'Ben followed before she went private, so he still sees it');
select tests.login(:'a');
select tests.ok((select count(*) from public.my_follow_requests() where id = :'c') = 1, 'Ann sees Cat''s request');
select tests.ok((select count(*) from public.profiles where id = :'c') = 1, 'and Cat''s profile, to decide');
select public.answer_follow_request(:'c', true);
select tests.login(:'c');
select tests.ok(tests.sees(tests.id('hello')), 'approved: Cat sees the post');
select public.unfollow_user(:'a');
select tests.ok(not tests.sees(tests.id('hello')), 'after unfollowing, she does not');
select public.follow_user(:'a');
select tests.login(:'e');
select public.set_public_profile(true);
select tests.ok(public.follow_user(:'a') = 'pending', 'Eli asks too');
select tests.login(:'a');
select public.answer_follow_request(:'e', false);
select tests.ok((select count(*) from public.my_follow_requests()) = 1, 'declining removes Eli''s request; Cat''s is left');
select public.set_private_account(false);
select tests.ok((select count(*) from public.my_follow_requests()) = 0, 'going public approves the requests left');
select tests.login(:'c');
select tests.ok((select relation = 'active' from public.profile_view('ann20')), 'Cat follows Ann now');

-- ── replies and likes (Ben shows his profile again)
select tests.login(:'b');
select public.set_public_profile(true);
insert into t_ids values ('reply', tests.post('nice', null, tests.id('hello')));
select tests.ok((select reply_count = 1 from public.post_cards where id = tests.id('hello')), 'the reply is counted');
select tests.ok((select count(*) from public.feed_posts('everyone') where id = tests.id('reply')) = 0, 'replies stay out of the Feed');
insert into public.post_likes (post_id, user_id) values (tests.id('hello'), :'b');
select tests.ok((select like_count = 1 and liked from public.post_cards where id = tests.id('hello')), 'Ben liked it');
select tests.ok(tests.throws(format($$ insert into public.post_likes (post_id, user_id) values (%L, %L) $$, tests.id('hello'), :'c')), 'nobody likes as someone else');
select tests.login(:'c');
select tests.ok((select like_count = 1 and not liked from public.post_cards where id = tests.id('hello')), 'Cat sees the count, not liked by her');

-- ── edits: your own text only
select tests.login(:'a');
update public.posts set body = 'hello again' where id = tests.id('hello');
select tests.ok((select body = 'hello again' and edited_at is not null from public.posts where id = tests.id('hello')), 'Ann edits her post');
select tests.ok(tests.throws(format($$ update public.posts set author_id = %L where id = %L $$, :'b', tests.id('hello'))), 'the author cannot be changed');
select tests.login(:'b');
update public.posts set body = 'hacked' where id = tests.id('hello');
select tests.ok((select body = 'hello again' from public.posts where id = tests.id('hello')), 'Ben cannot edit Ann''s post');

-- ── community posts: public communities you're a member of (Dan, a mod, writes one; Ben doesn't follow Dan)
select tests.login(:'d');
select public.set_public_profile(true);
insert into t_ids values ('cpost', tests.post('welcome', :'pub'));
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select tests.post('secret', %L) $$, :'priv')), 'no posts into a private community');
select tests.login(:'b');
select tests.ok(tests.throws(format($$ select tests.post('drive-by', %L) $$, :'pub')), 'non-members cannot post into a community');
select tests.ok(tests.throws(format($$ select tests.post('reply', null, %L) $$, tests.id('cpost'))), 'or reply in it (the reply stays in the community)');
select tests.ok(tests.sees(tests.id('cpost')), 'but Ben sees the community post');
select tests.ok((select count(*) from public.feed_posts('following') where id = tests.id('cpost')) = 0, 'not in Ben''s Following yet');
select public.follow_community(:'pub');
select tests.ok((select community_slug = 'social-pub' from public.feed_posts('following') where id = tests.id('cpost')), 'following the community brings it in');
select tests.ok(tests.throws(format($$ select public.follow_community(%L) $$, :'priv')), 'private communities cannot be followed');
select tests.login(:'a');
select tests.ok((select count(*) from public.feed_posts('following') where id = tests.id('cpost')) = 1, 'members get their community''s posts in Following');
reset role;
update public.communities set is_public = false where id = :'pub';
set role authenticated;
select tests.login(:'b');
select tests.ok(not tests.sees(tests.id('cpost')), 'made private: only members see its posts');
select tests.login(:'a');
select tests.ok(tests.sees(tests.id('cpost')), 'Ann still does');
reset role;
update public.communities set is_public = true where id = :'pub';
set role authenticated;

-- ── deletes: the author, or a mod (or higher) of the community
select tests.login(:'b');
select tests.ok(tests.throws(format($$ select public.delete_post(%L) $$, tests.id('cpost'))), 'Ben cannot delete Dan''s post');
select tests.login(:'a');
select public.delete_post(tests.id('cpost'));
select tests.ok(not tests.sees(tests.id('cpost')), 'the community''s owner removes a post in it');
insert into t_ids values ('gone', tests.post('soon gone'));
select public.delete_post(tests.id('gone'));
select tests.ok(not tests.sees(tests.id('gone')), 'the author deletes their own');
select tests.ok(tests.throws(format($$ select tests.post('late reply', null, %L) $$, tests.id('gone'))), 'no replies to a deleted post');

-- ── blocks: no seeing, following or replying; follows end both ways
select tests.login(:'a');
select public.block_user(:'b');
select tests.login(:'b');
select tests.ok(not tests.sees(tests.id('hello')), 'blocked: Ben no longer sees Ann''s posts');
select tests.ok((select relation = 'none' from public.profile_view('ann20')), 'his follow is gone');
select tests.ok(tests.throws(format($$ select public.follow_user(%L) $$, :'a')), 'and he cannot follow again');
select tests.login(:'a');
select tests.ok(not tests.sees(tests.id('reply')), 'Ann no longer sees Ben''s reply');
select tests.ok((select you_blocked from public.profile_view('ben20')), 'profile_view says she blocked him');
select public.unblock_user(:'b');

-- ── turning the public profile off hides it again; the posts are kept
select tests.login(:'a');
select public.set_public_profile(false);
select tests.login(:'e');
select tests.ok(not tests.sees(tests.id('hello')), 'off: Eli no longer sees Ann''s posts');
select tests.ok((select count(*) from public.profile_view('ann20')) = 0, 'or her profile');
select tests.login(:'c');
select tests.ok((select count(*) from public.profiles where id = :'a') = 1, 'Cat still sees her name (they follow each other)');
select tests.ok(not tests.sees(tests.id('hello')), 'but not her posts');
select tests.login(:'a');
select tests.ok(tests.sees(tests.id('hello')), 'Ann still sees her own');
select public.set_public_profile(true);

-- ── reports
select tests.login(:'c');
select public.report_post(tests.id('hello'), 'spam', 'not really');
reset role;
select tests.ok((select post_snapshot = 'hello again' and post_author_id = :'a' and reason = 'spam' from public.reports where post_id = tests.id('hello')), 'the report keeps a copy of the text');
set role authenticated;
select tests.login(:'a');
select tests.ok(tests.throws(format($$ select public.report_post(%L, 'spam') $$, tests.id('hello'))), 'you cannot report your own post');

-- ── the flood guard
select tests.login(:'e');
do $$ begin for i in 1..30 loop perform tests.post('post ' || i); end loop; end $$;
select tests.ok(tests.throws($$ select tests.post('one too many') $$), 'the 31st post in an hour is refused');

-- ── grants
select tests.ok(tests.throws($$ select public.posts_before_insert() $$), 'trigger functions are not callable');
reset role;
set role anon;
select tests.ok(tests.throws($$ select * from public.post_cards $$), 'anon reads no posts');
select tests.ok(tests.throws($$ select public.follow_user('c2000000-0000-0000-0000-00000000000a') $$), 'anon cannot follow');
reset role;

\echo all social tests passed
rollback;
