# Self-hosting Ctrl Room

Self-hosting is free and **never limited**: every feature, no message or call caps, no plan. The OpenCtrl Cloud
limits in `openctrl.json` only apply when `CTRLROOM_CLOUD=1`, which only the hosted OpenCtrl Cloud sets.

## What you need

- A Supabase project (hosted or self-hosted): Postgres, Auth and Realtime.
- Optional: LiveKit (LiveKit Cloud or `livekit-server`) for voice, video and screen share.
- Somewhere to run Next.js 15 (Vercel, a Node server, a container).

## Steps

1. `npx supabase link --project-ref <ref>` and `npx supabase db push` (applies every file in `supabase/migrations`).
2. Set the env vars from `.env.example`: the Supabase URL and anon key, `NEXT_PUBLIC_SITE_URL`, and the three
   `LIVEKIT_*` values if you want calls. Leave the OpenCtrl Cloud block unset.
3. In Supabase → Authentication → URL configuration, set the Site URL to your domain and add
   `https://<domain>/**` as a redirect URL (covers `/auth/callback` and `/auth/confirm`). For email links that work
   on any device, paste `supabase/templates/*.html` into Authentication → Email Templates (see "Email links and
   passwords" in `docs/CLOUD.md`). With Supabase's default templates, links only work in the browser that asked.
4. `npm run build && npm start` (or deploy to Vercel).

## Optional extras

- `/admin` (reports, takedowns): set `SUPABASE_SERVICE_ROLE_KEY` (server only) and `CTRLROOM_ADMIN_EMAILS`.
- Export: owners and admins can download a community from Settings → Export on any install.
- Continue with Google: in Google Cloud, create an OAuth client (Web application) whose authorized redirect URI is
  `https://<project-ref>.supabase.co/auth/v1/callback`; put its client ID and secret in Supabase → Authentication →
  Sign In / Providers → Google; then set `CTRLROOM_GOOGLE_SIGNIN=1`. Google returns through `/auth/callback`, which the
  `https://<domain>/**` redirect URL above already covers.
- Continue with OpenCtrl: set `OPENCTRL_CLIENT_ID`, `OPENCTRL_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`; the
  redirect URI to register on OpenCtrl is `https://<domain>/auth/openctrl/callback`.

## License

AGPL-3.0-only (see [LICENSING.md](LICENSING.md)). Running it unchanged, for yourself or your community, asks nothing
of you. If you change it and let other people use your version, offer them your source and set
`CTRLROOM_SOURCE_URL` to your fork.
