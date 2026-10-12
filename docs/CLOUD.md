# OPENCTRL Cloud: operator guide

Ctrl Room runs on OPENCTRL Cloud with a **Free tier** and the **$12/month OPENCTRL Cloud** subscription, which covers
every OpenCtrl original. This page covers what's limited, how it's enforced, and what to set up. The rules follow the
OPENCTRL build plan (Phase 7) and the kit checklist (`packages/mcp-kit/templates/CHECKLIST.md` in the OPENCTRL repo).

**A self-hosted Ctrl Room is never limited.** All of this is off unless `CTRLROOM_CLOUD=1`.

## What's metered

Limits come from the `cloud` section of [`openctrl.json`](../openctrl.json), never from constants in the code.

| Meter | Unit | Free | OPENCTRL Cloud (fair use) | Pack |
| --- | --- | --- | --- | --- |
| `messages` | messages a month (every message and thread reply people post) | 10,000 | 1,000,000 | +1,000,000 (`messages_1m`) |
| `call_minutes` | call minutes a month (per person in a call) | 300 | 10,000 | +10,000 (`calls_10k`) |
| `ai_replies` | AI answers a month (@ctrl and @openctrl) | 100 | 3,000 | +3,000 (`ai_3k`) |

These numbers are placeholders until real usage and the LiveKit and Supabase bills set them.

- **The workspace is the community owner.** Usage from every community someone owns adds up on their account, the
  same account an OPENCTRL Cloud subscription belongs to. Members, communities and history are never limited.
- **Messages** are counted by a database trigger as they're written (`messages_meter`).
- **Call minutes** are counted from LiveKit's `participant_left` webhook: time from join to leave, rounded up to the
  minute (`/api/livekit/webhook`, idempotent per event id).
- **AI answers** are counted when a helper posts a real answer (`record_ai_reply`, called by `src/lib/agent/run.ts`);
  limit notices and error replies don't count. Bot replies don't count as messages and skip the flood guard.
- Cost-only numbers (emails sent) feed the cost-to-serve estimate on `/admin`.

## Plans

| `cloud_plans.plan` | Tier | Limits |
| --- | --- | --- |
| `free` | free | the `free` amounts |
| `cloud` | cloud | `fair_use` plus packs |
| `grandfathered` (or no row) | unlimited | none |

Everyone who signed up before Cloud was switched on has no row and stays unlimited. New sign-ups get `free` only
while Cloud is on (`profiles_cloud_plan` trigger). Plans and packs are set by hand on `/admin` until OPENCTRL billing
sets them (build plan 7.3, through the Cloud contract's `setEntitlements`). Ctrl Room never calls Stripe.

## What happens at a limit

Nothing is ever deleted for going over. Reading, history, search and export always work.

- **Free tier at 100%:** new messages, new calls or new AI answers in that owner's communities pause until the
  month resets (UTC). Members see the reason when they try to post; the helper explains its own pause. Calls already
  running carry on. (The helpers' hourly and daily limits from `0002_agents.sql` apply on every plan.)
- **OPENCTRL Cloud subscriber:** never paused. Over fair use the dashboard and email offer the matching pack.
- **Notices** at 80% and 100%, once per meter per month, by email (daily cron, `/api/cron/usage`) and live on the
  owner's dashboard (`/app` and community Settings).

Enforcement is in the database (`supabase/migrations/0003_cloud.sql`), because the browser writes to Postgres
directly. The trigger reads `cloud_config`, which the server copies from `CTRLROOM_CLOUD` and `openctrl.json` on
start and whenever `/admin` loads (`src/lib/cloudSync.ts`). Errors meant for people start with `CR: `, and the app
shows them as they are.

## Email confirmation

While Cloud is on, a community can only be made public by someone whose email is confirmed. Turn on **Confirm email**
in Supabase → Authentication → Providers → Email for the hosted project; the dashboard offers a "Resend link" button.

## Abuse

- **Reports:** a flag on every message (others' messages) and "Report this community" on public join pages, both
  going to `/report/<slug>`. Reports reach the operator on `/admin`, not the community's mods. 10 an hour per person.
- **Takedowns** (operator only, on `/admin`): no new messages, calls or joins, and the community disappears from
  non-members. Members keep read access and owners/admins keep export. Lifting it restores everything.
- **Flood guard:** 30 messages a minute per person, everywhere (also self-hosted).
- Credential-harvest checks (as Clayform has for forms) don't apply to chat, so there are none.

## /admin

Open to signed-in people whose confirmed email is in `CTRLROOM_ADMIN_EMAILS`. It shows the Cloud switch and setup
checks, every workspace's usage against its limits, cost to serve from the unit costs you enter (per 1,000 messages,
per call minute, per email, per workspace), plan and pack overrides, open reports and takedowns. Sign up with the
admin email before giving anyone else access, so nobody else can claim it.

## Setup checklist for the hosted deployment

1. Apply the migrations: `npx supabase db push` (`0003_cloud.sql` adds everything above).
2. In Vercel set `SUPABASE_SERVICE_ROLE_KEY`, `CTRLROOM_ADMIN_EMAILS`, `RESEND_API_KEY`, `CTRLROOM_EMAIL_FROM`,
   `CTRLROOM_SUPPORT_EMAIL`, `CRON_SECRET` (and `OPENCTRL_CLOUD_URL` once billing is live). Leave `CTRLROOM_CLOUD`
   unset until launch.
3. LiveKit → Project settings → Webhooks: add `https://<your domain>/api/livekit/webhook` (signed with the same API
   key and secret).
4. Supabase → Authentication: turn on Confirm email.
5. Open `/admin`: check every line is green, send yourself a test email, enter unit costs.
6. Launch: set `CTRLROOM_CLOUD=1` and redeploy (the landing page copy is built with it). `/admin` shows "Limits: on".

## Tests

- `npm run db:test`: `supabase/tests/3_cloud.test.sql` (plans, metering, Free pause, subscriber never paused, calls,
  email gate, reports, takedowns, flood guard, Cloud off = unlimited) against a real Postgres.
- `npm test`: `tests/cloud.test.ts` (manifest, tiers, packs, notices, call minutes, costs, and a check that no Cloud
  code path deletes data).
