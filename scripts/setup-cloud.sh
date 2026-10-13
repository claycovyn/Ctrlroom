#!/usr/bin/env bash
# Sets up Ctrl Room's production Supabase project and Vercel project for OpenCtrl Cloud.
# Run it from the repo root on a machine where the Vercel CLI is logged in (`vercel login`) and you have a Supabase
# personal access token. Safe to re-run: every step overwrites the previous value.
#
#   SUPABASE_ACCESS_TOKEN=sbp_...   (supabase.com → Account → Access tokens)
#   SUPABASE_PROJECT_REF=abcd...    (the new project's ref, from its URL)
#   SITE_URL=https://ctrlroom.app   (or the *.vercel.app URL until the domain is attached)
#   ADMIN_EMAIL=you@example.com
#   RESEND_API_KEY=re_...           (a Resend domain must be verified for EMAIL_FROM's domain)
#   EMAIL_FROM="Ctrl Room <hello@ctrlroom.app>"
# Optional:
#   LIVEKIT_URL=wss://x.livekit.cloud LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...   (voice and video)
#   AI_BASE_URL=... AI_MODEL=... AI_API_KEY=...   SEARCH_PROVIDER=brave BRAVE_API_KEY=...   (@ctrl, @openctrl)
#   SEARCH_MONTHLY_LIMIT=900   (web searches a month for the whole server; brave defaults to 900, under its $5 credit)
#   SUPPORT_EMAIL=help@ctrlroom.app   OPENCTRL_CLOUD_URL=https://...   VERCEL_PROJECT=ctrlroom   VERCEL_SCOPE=<team>
#   DRY_RUN=1   print what would happen, change nothing
#
# It never turns limits on: CTRLROOM_CLOUD stays unset until you launch Free Cloud (docs/CLOUD.md, last step).
set -euo pipefail
cd "$(dirname "$0")/.."

need() { [ -n "${!1:-}" ] || { echo "Set $1 (see the top of $0)." >&2; exit 1; }; }
for v in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SITE_URL ADMIN_EMAIL RESEND_API_KEY EMAIL_FROM; do need "$v"; done
for c in curl jq openssl node npx vercel; do command -v "$c" >/dev/null || { echo "Install $c first." >&2; exit 1; }; done

DRY="${DRY_RUN:-}"
SITE_URL="${SITE_URL%/}"
REF="$SUPABASE_PROJECT_REF"
API="https://api.supabase.com/v1/projects/$REF"
PROJECT="${VERCEL_PROJECT:-ctrlroom}"
SCOPE=(); [ -n "${VERCEL_SCOPE:-}" ] && SCOPE=(--scope "$VERCEL_SCOPE")
run() { if [ -n "$DRY" ]; then echo "DRY: $*"; else "$@"; fi; }
step() { printf '\n== %s\n' "$*"; }

supa() { # method path [json]
  if [ -n "$DRY" ]; then
    echo "DRY: $1 $API$2" >&2
    [ "$1" = GET ] && echo '[{"name":"anon","api_key":"dry-anon"},{"name":"service_role","api_key":"dry-service"}]' || echo '{}'
    return
  fi
  curl -fsS -X "$1" "$API$2" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"}
}

step "Supabase: API keys"
KEYS="$(supa GET /api-keys)"
ANON="$(jq -r '.[] | select(.name=="anon") | .api_key' <<<"$KEYS")"
SERVICE="$(jq -r '.[] | select(.name=="service_role") | .api_key' <<<"$KEYS")"
[ -n "$ANON" ] && [ -n "$SERVICE" ] || { echo "Couldn't read the project's API keys." >&2; exit 1; }
SUPABASE_URL="https://$REF.supabase.co"
echo "anon and service_role keys read for $SUPABASE_URL"

step "Supabase Realtime: start it so realtime.messages exists"
# A new project's Realtime creates its own tables on the first connection, and 0001 adds policies on
# realtime.messages. One channel join from here is enough.
if [ -n "$DRY" ]; then echo "DRY: join a Realtime channel"; else
  node -e '
    const [ref, key] = process.argv.slice(1);
    const ws = new WebSocket(`wss://${ref}.supabase.co/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`);
    const end = (ok) => { console.log(ok ? "Realtime is up" : "Realtime did not answer"); try { ws.close(); } catch {} process.exit(ok ? 0 : 1); };
    ws.onopen = () => ws.send(JSON.stringify({ topic: "realtime:setup", event: "phx_join", payload: { config: {} }, ref: "1" }));
    ws.onmessage = (e) => end(JSON.parse(e.data).payload?.status === "ok");
    ws.onerror = () => end(false);
    setTimeout(() => end(false), 30000);
  ' "$REF" "$ANON"
fi

step "Supabase: link and apply migrations (0001 init, 0002 AI helpers, 0003 Cloud)"
run npx --yes supabase link --project-ref "$REF"
run npx --yes supabase db push

step "Supabase Auth: site URL, redirects, confirm email, send through Resend, branded emails"
# Supabase's built-in mailer only sends a few emails an hour, so production auth mail goes through Resend's SMTP.
# The email templates are supabase/templates/*.html, the same files and subjects supabase/config.toml uses locally.
FROM_ADDR="$(sed -E 's/.*<([^>]+)>.*/\1/' <<<"$EMAIL_FROM")"
FROM_NAME="$(sed -E 's/^"?([^"<]*[^ "<])"? *<.*/\1/' <<<"$EMAIL_FROM")"
T=supabase/templates
for t in confirmation magic_link recovery email_change invite; do
  [ -s "$T/$t.html" ] || { echo "Missing $T/$t.html." >&2; exit 1; }
done
AUTH_JSON="$(jq -n \
  --arg site "$SITE_URL" --arg redirects "$SITE_URL/auth/callback,$SITE_URL/**" \
  --arg pass "$RESEND_API_KEY" --arg from "$FROM_ADDR" --arg name "$FROM_NAME" \
  --rawfile confirmation "$T/confirmation.html" --rawfile magic_link "$T/magic_link.html" \
  --rawfile recovery "$T/recovery.html" --rawfile email_change "$T/email_change.html" \
  --rawfile invite "$T/invite.html" --arg invite_subject "You're invited to Ctrl Room" '{
    site_url: $site,
    uri_allow_list: $redirects,
    mailer_autoconfirm: false,
    external_email_enabled: true,
    smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: $pass,
    smtp_admin_email: $from, smtp_sender_name: $name,
    rate_limit_email_sent: 100,
    mailer_subjects_confirmation: "Confirm your Ctrl Room email",
    mailer_templates_confirmation_content: $confirmation,
    mailer_subjects_magic_link: "Your Ctrl Room sign-in link",
    mailer_templates_magic_link_content: $magic_link,
    mailer_subjects_recovery: "Reset your Ctrl Room password",
    mailer_templates_recovery_content: $recovery,
    mailer_subjects_email_change: "Confirm your new Ctrl Room email",
    mailer_templates_email_change_content: $email_change,
    mailer_subjects_invite: $invite_subject,
    mailer_templates_invite_content: $invite
  }')"
if [ -n "$DRY" ]; then
  jq -r 'to_entries[] | select(.key | startswith("mailer_")) | "DRY: auth \(.key) (\(.value | tostring | length) chars)"' <<<"$AUTH_JSON" >&2
fi
supa PATCH /config/auth "$AUTH_JSON" >/dev/null
echo "Auth configured: confirm email on, mail from $FROM_ADDR, branded emails from $T"

step "Vercel: link project $PROJECT"
run vercel link --yes --project "$PROJECT" "${SCOPE[@]}"

setenv() { # name value [sensitive]
  local name="$1" value="$2"
  [ -n "$value" ] || return 0
  if [ -n "$DRY" ]; then echo "DRY: vercel env $name (production)"; return; fi
  vercel env rm "$name" production --yes "${SCOPE[@]}" >/dev/null 2>&1 || true
  # NEXT_PUBLIC_ values ship to the browser (the anon key is public by design; RLS guards the data). Everything else
  # is stored as a secret. The CLI refuses to guess for a NEXT_PUBLIC_ value that looks like a key.
  local type=secret; [[ "$name" == NEXT_PUBLIC_* ]] && type=config
  printf '%s' "$value" | vercel env add "$name" production --type "$type" --yes "${SCOPE[@]}" >/dev/null
  echo "set $name"
}

step "Vercel: production environment"
CRON_SECRET_VALUE="${CRON_SECRET:-$(openssl rand -hex 32)}"
setenv NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL"
setenv NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON"
setenv SUPABASE_SERVICE_ROLE_KEY "$SERVICE"
setenv NEXT_PUBLIC_SITE_URL "$SITE_URL"
setenv CTRLROOM_ADMIN_EMAILS "$ADMIN_EMAIL"
setenv RESEND_API_KEY "$RESEND_API_KEY"
setenv CTRLROOM_EMAIL_FROM "$EMAIL_FROM"
setenv CTRLROOM_SUPPORT_EMAIL "${SUPPORT_EMAIL:-}"
setenv CRON_SECRET "$CRON_SECRET_VALUE"
setenv OPENCTRL_CLOUD_URL "${OPENCTRL_CLOUD_URL:-}"
setenv NEXT_PUBLIC_LIVEKIT_URL "${LIVEKIT_URL:-}"
setenv LIVEKIT_API_KEY "${LIVEKIT_API_KEY:-}"
setenv LIVEKIT_API_SECRET "${LIVEKIT_API_SECRET:-}"
setenv AI_BASE_URL "${AI_BASE_URL:-}"
setenv AI_MODEL "${AI_MODEL:-}"
setenv AI_API_KEY "${AI_API_KEY:-}"
setenv SEARCH_PROVIDER "${SEARCH_PROVIDER:-}"
setenv SEARXNG_URL "${SEARXNG_URL:-}"
setenv BRAVE_API_KEY "${BRAVE_API_KEY:-}"
setenv SEARCH_MONTHLY_LIMIT "${SEARCH_MONTHLY_LIMIT:-}"

step "Vercel: deploy to production"
run vercel deploy --prod --yes "${SCOPE[@]}"

step "Check"
if [ -z "$DRY" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/openctrl.json" || true)"
  echo "$SITE_URL/openctrl.json → $code"
fi

cat <<EOF

Done. Still to do by hand:
  1. Sign up at $SITE_URL with $ADMIN_EMAIL, confirm the email, then open $SITE_URL/admin:
     every line should be fine; send yourself a test email; enter unit costs.
  2. LiveKit (if set): Project settings → Webhooks → add $SITE_URL/api/livekit/webhook
  3. Domain: Vercel → $PROJECT → Domains. If SITE_URL changes, run this script again.
  4. Launch Free Cloud later: vercel env add CTRLROOM_CLOUD production (value 1), then redeploy.
EOF
