# Ctrl Room

**Where the collective talks.** An OpenCtrl original.

Ctrl Room is community chat with rooms, threads, voice and video. It is built around the things people dislike most about Discord and Slack:

| What people dislike | Ctrl Room |
|---|---|
| Slack's free plan cuts history at 90 days and paywalls search | Full history and full-text search, free, in every community |
| Notification overload | Quiet by default: only @mentions and replies to you ping. Each room can be set to Everything, Mentions or Muted |
| Coming back to a wall of unread messages | **While you were gone**: a recap of new messages, who talked, busy threads, decisions and your pings |
| Threads where conclusions get lost | Threads open side by side and can be **closed with an outcome**. The outcome shows in the room and is pinned to the board |
| Pins as a junk drawer | Each room has a **board** of decisions, links, docs and notes |
| Confusing permissions | Four roles: owner, admin, mod, member |
| Upsells and ID checks | No feature paywalls and no ID checks. Self-hosted: no paid tier and no limits. On OpenCtrl Cloud: a Free tier, and one $12/month plan for every OpenCtrl original |
| File links anyone can open | **Files and images** in rooms, threads and DMs (up to 10 MB each, 10 per message). Private: only people who can read the message can open them. Photos are shrunk and stripped of location data in the browser |
| Spam from strangers in your DMs | **Direct messages** and group DMs (up to 10 people). By default only people you share a community with can message you, first messages from new people land in **Requests**, and block and report are built in |
| Per-seat pricing | One account for any number of communities, each with its own invite links |
| Feeds built to keep you scrolling | **Feed** with two plain tabs: **Following** (people you follow, and public communities you're in or follow) and **Everyone**, newest first. No ranking. Posting and being followed are opt-in: turn on your **public profile** first, and make it private if only followers you approve should see your posts |

## Posts and follows

Next to the chat there's a public side (`supabase/migrations/0020_social.sql`, `0021_social_live.sql`, `src/app/(shell)`, `src/components/social`):

- **Home** (`/app`): a rail on the left (Home, Explore, Communities, Messages, Activity, Profile, Settings, Post and your account), the Feed in the middle, and **your communities on the right** with what's new in each (rooms with new messages, your mentions), Start a community, Join with an invite, public communities to explore and followers you don't follow back. Two columns on tablets; a tab bar on phones (Home, Communities, Post, Messages, Profile). It's one layout (`src/app/(shell)/layout.tsx`, `src/components/shell`) around Home, the Feed's pages, profiles, `/app/communities` and `/app/settings`, so the rail and its badges stay put as you move.
- **Settings** (`/app/settings`): your photo and display name, notifications, sounds, who can message you, the desktop app, usage on OpenCtrl Cloud, and your account. Each community keeps its own settings.

- **Public profiles, on by default.** Anyone signed in can see your name, photo and bio, follow you, and read your posts. Turn it off from your profile: then only people you share a community or a DM with can see you, as before, and you can't post.
- **Private accounts.** Following needs your approval, and only approved followers see your posts and your follower lists. Going public again approves everyone waiting.
- **Posts** are up to 500 characters, with up to 4 photos or videos (photos up to 10 MB, videos up to 50 MB; PNG, JPEG, WebP, GIF, MP4, WebM). The first link in a post shows a preview (title, description, image); the server fetches it from public addresses only and proxies the image, so readers' addresses never reach the linked site. Post to your followers or into a public community you're a member of. Replies, likes, edits (your own), deletes (your own, or a mod's in their community) and reports.
- **Feed** (on Home; `/app/feed` redirects there): Following (you, people you follow, public communities you're in or follow) and Everyone (every post you can see), newest first. New posts arrive live behind a "Show new posts" button. A post into a community shows the community's name and icon above it.
- **Community posts** at `/app/feed/c/<slug>` for public communities: members post there, anyone signed in can read and follow it. Linked as "Posts" in the community's sidebar.
- **Profiles** at `/u/<username>` show someone's posts when you're allowed to see them; follower and following lists at `/u/<username>/followers` and `/following`.
- **Activity** (`/app/feed/activity`): new followers and requests, approved requests, likes and replies, live, with a count on the Activity item (and the Feed icon inside a community).
- **Blocks** work here too: no seeing each other's posts, and follows between you end.

## Brand

Black, white and silver. Every asset comes from the original sheet, `public/brand/ctrlroom-brand-sheet.png`:

- `public/brand/ctrlroom-icon-{192,512,1024}.png`: the app icon (rounded tile, transparent corners). Next.js serves `src/app/icon.png` and `apple-icon.png` as the favicon and home-screen icon.
- `public/brand/ctrlroom-lockup-on-{dark,light}.png`: the "CTRL ROOM by OpenCtrl" lockup on a transparent background, one for each color scheme.
- `public/brand/ctrlroom-mark-on-{dark,light}.png`: the mark without the tile.
- `src/app/opengraph-image.png`: the link preview shown in iMessage, Slack, X and other apps.

In the UI, `signal` is the accent color: white in dark mode, ink in light mode (`src/app/globals.css`).

## AI helpers and docs

Mention one of the two helpers in any room:

- **@ctrl** answers questions and does research. It **searches the web** and **reads pages**, then lists its sources. It also uses the room or thread for context ("@ctrl summarize this thread").
- **@openctrl** answers questions about OpenCtrl apps **from the docs only**, and links the page it used.

Answers arrive as a thread reply, so the room stays quiet. While a helper works, the room shows what it's doing ("Ctrl · Searching the web: …").

**Open models.** The helpers talk to any OpenAI-compatible endpoint, so they run on open-source models: Ollama, vLLM, LM Studio or llama.cpp locally, or OpenRouter, Together or Groq hosted. Web search uses **SearXNG** (open source, self-hostable) or Brave. Set it up with the `AI_*`, `SEARCH_PROVIDER` and `SUPABASE_SERVICE_ROLE_KEY` values in `.env.example`.

**How it runs (`src/lib/agent`, `supabase/migrations/0002_agents.sql`):**

1. A database trigger turns a message that mentions a helper into a `bot_jobs` row. That means jobs only come from real messages, rate limited to 20 per person per hour and 300 per community per day.
2. The sender's browser calls `POST /api/agent`. The server claims the job and runs the agent loop after responding (up to 6 model turns, with tools).
3. The answer is posted with the service role as the bot's thread reply. Job status is broadcast on the room topic.

**Guardrails:**

- Page reads only reach public http(s) addresses, checked on every redirect, with a time limit and a size cap.
- Page and chat text is treated as information, never instructions.
- The helpers can only reply in the thread they were asked in.
- Hidden reasoning (`<think>`) and markdown the chat can't show are stripped from answers.

**Docs** live in `content/docs/<app>/NN-page.md`, one folder per OpenCtrl app with an `_app.json` for its name. They're served at **/docs**, and @openctrl searches them. To add another app's docs, add a folder.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind
- **Supabase**: Postgres, Auth, and Realtime. Live updates use *broadcast from the database* on private topics, not `postgres_changes`, so each event goes only to people in that room.
- **LiveKit**: voice, video and screen share (LiveKit Cloud, or self-hosted `livekit-server`)

There is no separate API server. The browser talks to Postgres with the user's JWT, and the **row-level security policies in `supabase/migrations/0001_init.sql` are the permission system**. Anything that crosses a permission boundary (joining, moderation, counters, closing threads) is a `SECURITY DEFINER` function that checks the caller's role itself.

## Run it locally

```bash
npm install
npx supabase start          # needs Docker; prints the local API URL and anon key
cp .env.example .env.local  # paste NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

`npx supabase start` applies the migrations automatically. Voice and video stay switched off until the three `LIVEKIT_*` values are set. Everything else works without them.

## Checks

```bash
npm run typecheck && npm run lint
npm test            # unit tests (message parsing, grouping, reactions, AI helpers, OpenCtrl Cloud plans and notices)
npm run db:test     # applies the migrations to a throwaway Postgres and runs the permission, agent and Cloud tests
npm run e2e         # two browsers chatting live against local Supabase (needs `npm run build` and `npx supabase start`;
                    # it starts a mock model and search engine so @ctrl and @openctrl are tested offline)
```

`db:test` needs only a local Postgres 14+ (no Docker). It covers privacy between communities, invites (expiry, use limits, bans), announcement rooms, mention and reply pings, column-level write limits, mod/admin/owner powers, thread outcomes, unread counts, catch-up, search and realtime topic access.

## OpenCtrl Cloud

Ctrl Room is an OpenCtrl Original. Its [`openctrl.json`](openctrl.json) (also served at `/openctrl.json`) declares what
OpenCtrl Cloud meters (messages, call minutes and AI answers a month), the Free tier, the fair-use limits for the $12/month OpenCtrl
Cloud subscription and the add-on packs. Limits only apply when `CTRLROOM_CLOUD=1`: **self-hosting is never limited**.
Nothing is ever deleted for going over, and export always works. Operator guide: [docs/CLOUD.md](docs/CLOUD.md).

## OpenCtrl Shift invites (the `openctrl` community)

Shift's waitlist lives here: anyone who joins the `openctrl` community and reacts to the pinned post in #waitlist
gets an OpenCtrl Shift invite link by DM from the OpenCtrl account. No migration; it uses the tables as they are.

- **Cron** `/api/cron/shift-invites`, every 5 minutes (`vercel.json`), with `Authorization: Bearer $CRON_SECRET` like
  `/api/cron/usage`. Off (answers `configured: false`) until `SHIFT_CTRLROOM_SECRET` is set.
- **The post**: the newest message in #waitlist pinned to the board ("Pin to board") by a mod or above, or the
  message named by `CTRLROOM_SHIFT_INVITE_MESSAGE_ID`.
- **Who gets one**: each person who reacted (any emoji), isn't a bot, is a member and not banned, has a confirmed
  email, and takes DMs from OpenCtrl. "Who can message you: Nobody", or a block, means skip: nothing is recorded or
  asked of Shift, and the next run after they change it picks them up. The default setting allows it (OpenCtrl speaks
  for the community they asked in).
- **Shift** (`SHIFT_ISSUE_URL`, default `https://shift.openctrl.app/api/invites/issue`) gets
  `{ externalId: <user id>, source: "ctrlroom" }`, signed with HMAC-SHA256 over `<unix seconds>.<nonce>.<body>` and
  `SHIFT_CTRLROOM_SECRET`. It keeps one code per user id and says `fresh: true` only the first time. Its daily cap
  answers 429, and Shift open to everyone answers 410; either ends the run, and the next run carries on.
- **The DM** goes in the person's 1:1 with the OpenCtrl account, straight to their inbox (reacting was the request):
  "Here's your invite to OpenCtrl Shift: <url>. It works once. Once you're in, you'll get five of your own to share."
  The 0011 triggers (blocks, flood guard, realtime) and the 0014 push still apply.
- **No duplicates**: someone who already has an invite DM is skipped without asking Shift; a DM is sent only for a
  fresh code, so two runs at once can't both send. A code issued over 10 minutes ago that has no DM (the DM failed)
  and isn't used is sent again. At most 20 DMs and 40 people checked per run.
- **By hand**: post the invite message in #waitlist and pin it to the board (as a mod or above).
- Code: `src/lib/shiftInvites.ts` (rules, signed client), `src/lib/shiftInviteStore.ts` (service-role reads and the
  DM), `tests/shiftInvites.test.ts` (mocked Shift and Supabase).

| Env | |
| --- | --- |
| `SHIFT_CTRLROOM_SECRET` | The same value as in Shift's project (at least 32 characters) |
| `SHIFT_ISSUE_URL` | Optional; defaults to `https://shift.openctrl.app/api/invites/issue` |
| `CTRLROOM_SHIFT_INVITE_MESSAGE_ID` | Optional; the invite post's message id instead of the pinned one |
| `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | Already used by the other cron and the bots |

## Deploy

1. **Supabase**: create a project, then `npx supabase link --project-ref <ref>` and `npx supabase db push`.
   Under Auth → URL configuration, set the Site URL to your domain and add `https://<domain>/**` as a redirect URL. Use the email templates in `supabase/templates/` so sign-up and reset links work on any device ([docs/CLOUD.md](docs/CLOUD.md#email-links-and-passwords)).
2. **LiveKit**: create a project at cloud.livekit.io (or self-host) and copy the URL, API key and secret.
3. **Vercel**: import the repo and set the env vars from `.env.example`.
4. **OpenCtrl Cloud only**: the extra env vars, the LiveKit webhook and the cron are in [docs/CLOUD.md](docs/CLOUD.md). Self-hosters skip this.

## Data model

```
communities ─┬─ community_members (role)   bans   invites
             └─ rooms (text | voice, post_min_role)
                  ├─ messages (parent_id = thread, outcome, soft delete, tsvector)
                  │    ├─ reactions
                  │    ├─ message_attachments (private "attachments" bucket)
                  │    └─ mentions (mention | reply)  → user:<id> topic
                  ├─ board_items (decision | link | doc | note)
                  └─ room_state (last_read_at, notify)  per user

dm_conversations (1:1 per pair, or group ≤ 10) ─┬─ dm_members (active | request | left, muted, last_read_at)
                                               └─ dm_messages ── dm_reactions, message_attachments   → each member's user:<id> topic
dm_settings (who can message you)   blocks
```

Realtime topics: `room:<id>` (messages, reactions, board, typing), `community:<id>` (room list and activity pings), `user:<id>` (mentions, replies and direct messages).

## Scaling notes

- Messages are paged 50 at a time. The indexes cover room timelines, threads and search.
- Unread counts stop at 100 per room, so a busy room never forces a full scan.
- Broadcast topics are per room, so a busy room doesn't fan out to the whole community.
- Supabase Realtime and LiveKit both scale out without code changes. At very large sizes, the next steps are read replicas for history and search, and partitioning `messages` by community.

## Roadmap

- Mobile apps (the web app is responsive and installable today)
- An optional AI-written catch-up summary layered on the deterministic one
- Custom emoji, member profiles and a public community directory

## License

[AGPL-3.0-only](LICENSE), copyright Clayton Sinclair. See [docs/LICENSING.md](docs/LICENSING.md) for what that means
in practice, and [docs/CLA.md](docs/CLA.md) for contributions. `src/lib/mcp-kit/` (vendored from the OpenCtrl kit) is MIT.
