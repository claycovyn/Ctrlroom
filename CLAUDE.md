# Ctrl Room — notes for Claude Code

Community chat (rooms, threads, boards, voice/video). An OpenCtrl Original. Next.js 15 App Router, React 19,
TypeScript, Tailwind, Supabase (Postgres + Auth + Realtime), LiveKit.

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint`
- `npm test` (vitest: `tests/`) · `npm run db:test` (applies `supabase/migrations/*` to a throwaway Postgres with
  the stand-ins in `supabase/tests/stubs.sql`, then runs `supabase/tests/*.test.sql`; no Docker needed)
- `npm run e2e` needs `npx supabase start` (Docker).

## Architecture
- No API server: the browser talks to Postgres with the user's JWT. **Row-level security in the migrations is the
  permission system.** Anything that crosses a permission boundary is a `SECURITY DEFINER` function that checks the
  caller itself. New functions are executable by PUBLIC by default: revoke/grant explicitly (see the end of
  `0003_cloud.sql`).
- New schema goes in a new numbered migration; never edit an applied one. Add SQL tests for every rule.
- The service-role client (`src/lib/supabase/admin.ts`) is only for operator work (Cloud sync, webhook metering,
  notices, `/admin`), the AI helpers' bot work and the OpenCtrl sign-in bridge (below), never to read or write a
  person's data on their behalf.

## Continue with OpenCtrl (OIDC)
- Off unless `OPENCTRL_CLIENT_ID` + `OPENCTRL_CLIENT_SECRET` are set (`OPENCTRL_ISSUER` defaults to https://openctrl.app).
  Redirect URI to register on OpenCtrl: `<site>/auth/openctrl/callback`.
- Supabase Auth can't use OpenCtrl as a provider, so `src/lib/openctrlBridge.ts` bridges it: after the ID token checks
  out (`src/lib/openctrlLogin.ts`), the server gets a one-time magic-link token from `auth.admin.generateLink` (no
  email is sent) and redeems it with `verifyOtp` into the normal session cookies. This is the one auth use of the
  service-role client; it touches only `openctrl_links`, `openctrl_account_by_email` (0017) and the Auth admin API.
- Links by email only when both OpenCtrl and Supabase confirmed it; otherwise the person signs in with their password
  once (`login/actions.ts` finishes the link). New accounts need an email OpenCtrl confirmed.

## Continue with Google
- Supabase Auth's own Google provider: `/auth/google/start` calls `signInWithOAuth` with
  `redirectTo: <site>/auth/callback?via=google&next=…`; the callback exchanges the PKCE code. No service role.
- Button shows only when `CTRLROOM_GOOGLE_SIGNIN=1` (the app can't see Supabase's provider config). Redirect URI to
  register on the Google OAuth client: `https://<project-ref>.supabase.co/auth/v1/callback`.
- Sign-in and sign-up share `src/app/login/ProviderButtons.tsx`; order and visibility live in
  `src/lib/signinProviders.ts`: OpenCtrl, then Google, then one "or with email" divider. Neither set up = email only.

## OpenCtrl Cloud (build plan 7.1–7.2) — guide: `docs/CLOUD.md`
- Limits come from `openctrl.json` → `cloud` via the vendored kit (`src/lib/mcp-kit/`, MIT, don't edit it here;
  change `packages/mcp-kit` in the OpenCtrl repo and copy `manifest.ts`/`cloud.ts` back). `src/lib/cloud.ts` is the
  pure layer (plans, tiers, status, notices, costs).
- **Limits only when `CTRLROOM_CLOUD=1`**; self-hosted is never limited. The DB enforces from `cloud_config`, which
  `src/lib/cloudSync.ts` writes on server start (`src/instrumentation.ts`) and on `/admin` load.
- Workspace = community owner. Plans `free` / `cloud` / `grandfathered` (no row = grandfathered). Free at a limit
  pauses new messages/calls; subscribers are never paused (offer a pack). **Nothing is ever deleted for usage;
  export (`/api/c/[slug]/export`) always works.** `tests/cloud.test.ts` fails if a Cloud path deletes data.
- `meter()` never raises. DB errors for people start with `CR: ` (`src/lib/cloudErrors.ts` shows them).
- Call minutes: LiveKit webhook → `record_call` (idempotent per event). AI answers: `record_ai_reply` after a real
  answer; Free over its AI limit → job `limited` with error `cloud:ai_replies`. Notices: daily cron `/api/cron/usage`.

## Hosting and commits
- GitHub: https://github.com/claycovyn/ctrlroom. Vercel Pro team "claysin96-gmailcom's projects": commits must be authored by
  `claycovyn <283821699+claycovyn@users.noreply.github.com>` with **no `Co-Authored-By:` trailer**, or the deploy
  is blocked.

## License
AGPL-3.0-only, copyright Clayton Sinclair (`docs/LICENSING.md`). Outside PRs need the CLA line (`docs/CLA.md`).
Check new dependencies' licenses for AGPL compatibility.

## Rules
- Copy: plain, short, no AI buzzwords. Brand: black, white and silver; `signal` is the accent; `alert` only for
  errors and paused states. Product name "Ctrl Room", maker "OpenCtrl"; the subscription is "OpenCtrl Cloud".
- Dialogs: `useConfirm()` / `usePrompt()` from `src/components/Dialogs.tsx` (custom forms: its `<ModalSheet>`); never
  the browser's `confirm()`, `prompt()` or `alert()`.
- Never claim a feature that isn't built. The only prices in copy are $0 and $12/month.
