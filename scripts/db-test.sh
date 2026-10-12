#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local Postgres (with Supabase stand-ins)
# and runs the RLS / function tests in supabase/tests/*.test.sql.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${DB_TEST_PORT:-55432}"
RUN=()
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUN=(runuser -u postgres --); fi
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
status=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  if "${PSQL[@]}" -o /dev/null -f "$t"; then echo "ok   $(basename "$t")"; else echo "FAIL $(basename "$t")"; status=1; fi
done
exit $status
