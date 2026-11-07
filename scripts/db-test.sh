#!/usr/bin/env bash
# Runs the Supabase migrations + schema tests on a throw-away local Postgres (15+),
# using supabase/tests/supabase_stub.sql in place of Supabase's auth/storage schemas.
# Usage: npm run db:test      (needs initdb/pg_ctl/psql on PATH or PG_BIN set)
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -n "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

TMP="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = 0 ]; then
  # initdb refuses to run as root
  chown postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi
PORT="${PGTEST_PORT:-54329}"
cleanup() { "${RUN_AS[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migrate $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# Sync engine against the same database (src/lib/cloud/sync.it.test.ts)
run_it() {
  PGTEST_URL="postgresql://postgres@localhost:$PORT/postgres?host=$TMP" npx vitest run src/lib/cloud/sync.it.test.ts
}
# -t: rows only; drop the echo of set_config()/ids so only failures and the result show
"${PSQL[@]}" -t -f supabase/tests/schema.test.sql | grep -Ev '^[[:space:]]*([0-9a-f-]{36})?[[:space:]]*$'
run_it
