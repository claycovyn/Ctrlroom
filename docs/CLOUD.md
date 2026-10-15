# OpenCtrl Cloud: operator guide

Ctrl Room runs on OpenCtrl Cloud with a **Free tier** and the **$12/month OpenCtrl Cloud** subscription, which covers
every OpenCtrl original. This page covers what's limited, how it's enforced, and what to set up. The rules follow the
OpenCtrl build plan (Phase 7) and the kit checklist (`packages/mcp-kit/templates/CHECKLIST.md` in the OpenCtrl repo).

**A self-hosted Ctrl Room is never limited.** All of this is off unless `CTRLROOM_CLOUD=1`.

## What's metered

Limits come from the `cloud` section of [`openctrl.json`](../openctrl.json), never from constants in the code.

| Meter | Unit | Free | OpenCtrl Cloud (fair use) | Pack |
| --- | --- | --- | --- | --- |
| `messages` | messages a month (every message and thread reply people post) | 10,000 | 1,000,000 | +1,000,000 (`messages_1m`) |
| `call_minutes` | call minutes a month (per person in a call) | 300 | 10,000 | +10,000 (`calls_10k`) |
| `ai_replies` | AI answers a month (@ctrl and @openctrl) | 100 | 3,000 | +3,000 (`ai_3k`) |

These numbers are placeholders until real usage and the LiveKit and Supabase bills set them.

- **The workspace is the community owner.** Usage from every community someone owns adds up on their account, the
  same account an OpenCtrl Cloud subscription belongs to. Members, communities and history are never limited.
- **Messages** are counted by a database trigger as they're written (`messages_meter`).
- **Call minutes** are counted from LiveKit's `participant_left` webhook: time from join to leave, rounded up to the
  minute (`/api/livekit/webhook`, idempotent per event id).
- **AI answers** are counted when a helper posts a real answer (`record_ai_reply`, called by `src/lib/agent/run.ts`);
  limit notices and error replies don't count. Bot replies don't count as messages and skip the flood guard.
- Cost-only numbers (emails sent, and chat file bytes as `attachment_bytes` in `usage_daily`, 0013) feed the
  cost-to-serve estimate on `/admin`. Files have no meter, Free limit or fair-use limit in `openctrl.json` (the kit
  needs a fair-use number for every meter, and none has been chosen), so they never pause anything. DM files aren't
  in any workspace; each person has a 500 MB cap on them instead (`attachment_dm_cap_bytes`).
- The daily cron also removes the Storage bytes of deleted messages' files and of uploads never sent within 24 hours
  (`attachments_cleanup`). That's people's own deletions, never usage.

## Plans

| `cloud_plans.plan` | Tier | Limits |
| --- | --- | --- |
| `free` | free | the `free` amounts |
| `cloud` | cloud | `fair_use` plus packs |
| `grandfathered` (or no row) | unlimited | none |

Everyone who signed up before Cloud was switched on has no row and stays unlimited. New sign-ups get `free` only
while Cloud is on (`profiles_cloud_plan` trigger). Plans and packs are set by hand on `/admin` until OpenCtrl billing
sets them (build plan 7.3, through the Cloud contract's `setEntitlements`). Ctrl Room never calls Stripe.

## What happens at a limit

Nothing is ever deleted for going over. Reading, history, search and export always work.

- **Free tier at 100%:** new messages, new calls or new AI answers in that owner's communities pause until the
  month resets (UTC). Members see the reason when they try to post; the helper explains its own pause. Calls already
  running carry on. (The helpers' hourly and daily limits from `0002_agents.sql` apply on every plan.)
- **OpenCtrl Cloud subscriber:** never paused. Over fair use the dashboard and email offer the matching pack.
- **Notices** at 80% and 100%, once per meter per month, by email (daily cron, `/api/cron/usage`) and live on the
  owner's dashboard (`/app` and community Settings).

Enforcement is in the database (`supabase/migrations/0003_cloud.sql`), because the browser writes to Postgres
directly. The trigger reads `cloud_config`, which the server copies from `CTRLROOM_CLOUD` and `openctrl.json` on
start and whenever `/admin` loads (`src/lib/cloudSync.ts`). Errors meant for people start with `CR: `, and the app
shows them as they are.

## Email confirmation

While Cloud is on, a community can only be made public by someone whose email is confirmed. Turn on **Confirm email**
in Supabase → Authentication → Providers → Email for the hosted project; the dashboard offers a "Resend link" button.

## Email links and passwords

Every auth email links to `/auth/confirm?token_hash=…&type=…&next=…` (`{{ .TokenHash }}` in
`supabase/templates/*.html`, not `{{ .ConfirmationURL }}`), so a link works in any browser or device, not only the
one that asked for it.

| Email | `type` | Lands on |
| --- | --- | --- |
| Confirm sign-up | `email` | `next` (from sign-up, else `/app`) |
| Sign-in link | `email` | `next`, else `/app` |
| Reset password | `recovery` | `/auth/reset` (set a new password), then `/app` |
| Invite | `invite` | `/auth/reset` (choose a password), then `next` or `/app` |
| Change email | `email_change` | `next`, else `/app` |

- Opening a link only shows a one-button page. Nothing is verified until the button is pressed (a form POST), so mail
  scanners that open every link (Outlook Safe Links and the like) can't use it up.
- `next` is only ever a path on this site. A bad or used link goes to `/login?error=link` ("That link expired or was
  already used. Send a new one.").
- **Forgot password:** "Forgot password?" on the sign-in form → `/forgot` → `resetPasswordForEmail`. The answer is
  the same whether or not the account exists. Rate limits are Supabase Auth's (one email per address per
  `max_frequency`, plus the project's emails-per-hour cap, 100 via `setup-cloud.sh`); Ctrl Room adds none.
- `/auth/reset` needs the session the reset link creates; without one it sends people back to `/forgot`.
- `/auth/callback` still handles OAuth and `?code=` (PKCE) links, for projects on Supabase's default templates. Those
  only work in the browser that asked for them.

## Abuse

- **Reports:** a flag on every message (others' messages) and "Report this community" on public join pages, both
  going to `/report/<slug>`. Reports reach the operator on `/admin`, not the community's mods. 10 an hour per person.
- **Takedowns** (operator only, on `/admin`): no new messages, calls or joins, and the community disappears from
  non-members. Members keep read access and owners/admins keep export. Lifting it restores everything.
- **Flood guard:** 30 messages a minute per person, everywhere (also self-hosted).
- Credential-harvest checks (as Clayform has for forms) don't apply to chat, so there are none.

## Web search budget

@ctrl's web search is paid for by the operator, not by workspaces. Brave gives $5 of credit a month (about 1,000
searches at $5 per 1,000) and bills every search past it, so the whole server has a monthly budget:
`SEARCH_MONTHLY_LIMIT` (default 900 with `SEARCH_PROVIDER=brave`; SearXNG isn't counted unless you set it). Each search
takes one from `service_quota` (`0005_service_quota.sql`) before Brave is called. When the budget is spent, or the
count can't be read, Brave isn't called: the room shows "Web search is paused until next month" and @ctrl answers
without searching. It starts again on the 1st (UTC). `/admin` shows "Web searches this month: N of LIMIT". This is on
whether or not `CTRLROOM_CLOUD` is set.

## /admin

Open to signed-in people whose confirmed email is in `CTRLROOM_ADMIN_EMAILS`. It shows the Cloud switch and setup
checks, every workspace's usage against its limits, cost to serve from the unit costs you enter (per 1,000 messages,
per call minute, per email, per workspace), plan and pack overrides, open reports and takedowns. Sign up with the
admin email before giving anyone else access, so nobody else can claim it.

## Setup checklist for the hosted deployment

`scripts/setup-cloud.sh` does steps 1, 2 and 4 (plus Supabase Auth's site URL, redirects, Resend SMTP and the auth
email templates) from your machine; run it with `DRY_RUN=1` first. The auth emails (confirm sign-up, sign-in link,
reset password, change email, invite) are `supabase/templates/*.html`; `supabase/config.toml` uses the same files
locally. After editing one, run the script again to update the hosted project. The redirect allow-list it sets
(`SITE_URL/**`) already covers `/auth/confirm`.

1. Apply the migrations: `npx supabase db push` (`0003_cloud.sql` adds everything above).
2. In Vercel set `SUPABASE_SERVICE_ROLE_KEY`, `CTRLROOM_ADMIN_EMAILS`, `RESEND_API_KEY`, `CTRLROOM_EMAIL_FROM`,
   `CTRLROOM_SUPPORT_EMAIL`, `CRON_SECRET`, the push keys (Push notifications, below) (and `OPENCTRL_CLOUD_URL` once billing is live). Leave `CTRLROOM_CLOUD`
   unset until launch.
3. LiveKit → Project settings → Webhooks: add `https://<your domain>/api/livekit/webhook` (signed with the same API
   key and secret).
4. Supabase → Authentication: turn on Confirm email.
5. Open `/admin`: check every line is green, send yourself a test email, enter unit costs.
6. Launch: set `CTRLROOM_CLOUD=1` and redeploy (the landing page copy is built with it). `/admin` shows "Limits: on".

## Push notifications

Web Push to iPhone/iPad Home Screen apps (iOS 16.4+), Android and desktop browsers. How a mention becomes a
notification:

1. The message insert writes `public.mentions` (0001). The `mentions_push` trigger (0014) checks the recipient's
   `push_prefs` (kind switches, quiet hours), the room's mute, blocks (0011) and that they have a subscribed device,
   then writes one `push_outbox` row (duplicates collapse). Direct messages (`dm_messages_push`) and call starts
   (`push_call_started`, from the LiveKit `participant_joined` webhook) do the same through `enqueue_push`.
2. `push_nudge()` calls `POST /api/push/dispatch` through **pg_net** once per transaction, after commit, with
   `Authorization: Bearer <secret>` from `private.push_config` (a schema signed-in people can't read).
3. The route claims rows with the service role (`claim_push`), sends with `web-push` (VAPID), and reports back
   (`finish_push`): sent rows are deleted, subscriptions answering 404/410 are deleted, other failures retry (3 tries,
   within an hour; older rows are dropped).
4. The service worker (`public/sw.js`) shows it; a tap opens the message.

Fallback without pg_net: after sending a message with an @mention, a thread reply or a DM, the app itself calls the
dispatch route (signed-in users only; it only sends what the database already queued). Vercel Pro allows frequent crons (the team is on Pro),
so they can't be the fallback. Supabase's pg_cron could call `push_nudge()` every minute if you want one more.

Setup (`scripts/setup-cloud.sh` does all of it):

- pg_net: the 0014 migration runs `create extension if not exists pg_net with schema extensions` when the server has
  it (hosted Supabase does; Dashboard → Database → Extensions shows it). Without it, only the app's own nudge delivers.
- Vercel env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`), `PUSH_DISPATCH_SECRET`.
  Keep the VAPID pair stable: a new pair means every device has to turn notifications on again.
- The database: `private.push_config` gets the dispatch URL (`<site>/api/push/dispatch`) and the same secret, via
  the Management API's SQL endpoint.

Not applied on the server: Do not disturb and Away (presence lives only in the browser). Quiet hours are the server
side equivalent.

## Tests

- `npm run db:test`: `supabase/tests/3_cloud.test.sql` (plans, metering, Free pause, subscriber never paused, calls,
  email gate, reports, takedowns, flood guard, Cloud off = unlimited) against a real Postgres.
- `npm run db:test`: `supabase/tests/5_service_quota.test.sql` (search budget stops at the limit, per service and month,
  server only). `npm test`: `tests/searchQuota.test.ts` (limit from env, no Brave call when the budget is spent or unreadable).
- `npm run db:test`: `supabase/tests/14_push.test.sql` (own devices and settings only, mention/reply/DM/call rules,
  mutes, blocks, quiet hours, one nudge per transaction, the secret and outbox unreadable). `npm test`:
  `tests/push.test.ts` (subscription parsing, payloads, outbox draining with a fake sender, 404/410 cleanup).
- `npm test`: `tests/cloud.test.ts` (manifest, tiers, packs, notices, call minutes, costs, and a check that no Cloud
  code path deletes data).
