#!/usr/bin/env bash
# All smoke tests with one command, in a Claude cloud session or on any Linux box with a local
# PostgreSQL (spec cloud-testing-2026-11-21, AC1). Nothing touches production:
#   1. starts the local PostgreSQL cluster if it is down;
#   2. creates the throwaway role and database if missing (smoke/smoke, haccp_smoke);
#   3. prisma generate + db push + seed;
#   4. runs the DB-level scenarios (scripts/e2e/run-all.sh), then starts `next dev` without the
#      Turbopack file cache and runs the browser smoke (scripts/smoke/new-features.smoke.cjs) on
#      iPhone width — one after the other, as in CI: the parallel-payment scenario is timing-sensitive;
#   5. stops the dev server and exits non-zero if anything failed.
#
#   npm run smoke:local                      # everything
#   SMOKE_ONLY=db npm run smoke:local        # DB scenarios only
#   SMOKE_ONLY=browser npm run smoke:local   # browser smoke only
#   bash scripts/smoke/run-local.sh new-features-check   # these DB scenarios + browser smoke
#
# Settings: SMOKE_PORT (3005), SMOKE_SHOTS (smoke-shots: screenshots), SMOKE_DB_NAME, SMOKE_DB_USER,
# SMOKE_DB_PASSWORD. The developer's .env is not used for the database or secrets: everything the
# app needs is set here, the same way CI sets it (.github/workflows/nightly-e2e.yml).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ONLY="${SMOKE_ONLY:-}"
PORT="${SMOKE_PORT:-3005}"
SHOTS="${SMOKE_SHOTS:-smoke-shots}"
DB_NAME="${SMOKE_DB_NAME:-haccp_smoke}"
DB_USER="${SMOKE_DB_USER:-smoke}"
DB_PASS="${SMOKE_DB_PASSWORD:-smoke}"

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?sslmode=disable"
export DATABASE_URL_DIRECT="$DATABASE_URL"
# scripts/e2e/env.ts: process environment only, never the developer's .env.
export DOTENV_CONFIG_PATH=/dev/null
export NEXTAUTH_URL="http://localhost:${PORT}"
export NEXTAUTH_SECRET="local-smoke-dummy-secret-0123456789"
export INTEGRATION_KEY_SECRET="local-smoke-dummy-integration-key-0123456789"
export CRON_SECRET="local-smoke-dummy-cron-secret"
export PLATFORM_ORG_ID="platform"
export SMTP_HOST=""
export TELEGRAM_BOT_TOKEN=""
export NEXT_TELEMETRY_DISABLED=1
# next.config.ts: no Turbopack file cache in `next dev` — a cache left by an earlier run made next dev
# answer 404 on /login or hang compiling a route.
export NEXT_DEV_FS_CACHE=0

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'smoke:local: %s\n' "$*" >&2; exit 1; }

# Run a command as the postgres superuser (root in a cloud session, sudo elsewhere).
as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    (cd / && runuser -u postgres -- "$@")
  elif command -v sudo >/dev/null 2>&1; then
    (cd / && sudo -n -u postgres "$@")
  else
    return 1
  fi
}

step "PostgreSQL"
if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
  command -v pg_lsclusters >/dev/null 2>&1 || fail "no local PostgreSQL (pg_lsclusters not found); install postgresql-16"
  read -r PG_VER PG_CLUSTER _ < <(pg_lsclusters -h | head -1)
  [ -n "${PG_VER:-}" ] || fail "no PostgreSQL cluster (pg_lsclusters is empty)"
  if [ "$(id -u)" -eq 0 ]; then pg_ctlcluster "$PG_VER" "$PG_CLUSTER" start; else sudo -n pg_ctlcluster "$PG_VER" "$PG_CLUSTER" start; fi \
    || fail "could not start PostgreSQL ${PG_VER}/${PG_CLUSTER}"
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 -q && break; sleep 1; done
  pg_isready -h 127.0.0.1 -p 5432 -q || fail "PostgreSQL did not come up"
fi
if ! PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc "select 1" >/dev/null 2>&1; then
  as_postgres psql -v ON_ERROR_STOP=1 -q <<SQL || fail "could not create role ${DB_USER} / database ${DB_NAME} (need the postgres superuser)"
DO \$\$BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASS}' CREATEDB;
  END IF;
END\$\$;
SQL
  as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 \
    || as_postgres createdb -O "$DB_USER" "$DB_NAME" || fail "could not create database ${DB_NAME}"
fi
echo "database: ${DB_NAME} on 127.0.0.1:5432 (user ${DB_USER})"

step "Dependencies and schema"
[ -d node_modules/.bin ] && [ -x node_modules/.bin/next ] || npm ci --no-audit --no-fund || fail "npm ci failed"
npx prisma generate >/dev/null || fail "prisma generate failed"
npx prisma db push 2>&1 | tail -2
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "prisma db push failed"
npx tsx prisma/seed.ts >/dev/null 2>&1 || fail "seed failed (run: npx tsx prisma/seed.ts)"

DEV_PID=""
LOG="$(mktemp -t smoke-dev.XXXXXX.log)"
cleanup() {
  # The dev server runs in its own process group (setsid): stop next and its workers together.
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -- "-$DEV_PID" 2>/dev/null || kill "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

DB_RESULT="skipped"
if [ "$ONLY" != "browser" ]; then
  step "DB scenarios"
  if bash scripts/e2e/run-all.sh "$@"; then DB_RESULT="passed"; else DB_RESULT="FAILED"; fi
fi

BROWSER_RESULT="skipped"
if [ "$ONLY" != "db" ]; then
  step "next dev on port ${PORT} (log: ${LOG})"
  if curl -s -o /dev/null -m 2 "http://localhost:${PORT}/"; then fail "port ${PORT} is busy — set SMOKE_PORT"; fi
  setsid npx next dev -p "$PORT" >"$LOG" 2>&1 &
  DEV_PID=$!
  step "Waiting for the app"
  NOT_FOUND=0
  for _ in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w "%{http_code}" -m 60 "http://localhost:${PORT}/login")"
    [ "$code" = "200" ] && break
    # The app answers, but /login is "not found": seen with a stale .next/dev cache left by another
    # code state. Waiting longer does not help.
    if [ "$code" = "404" ]; then NOT_FOUND=$((NOT_FOUND + 1)); else NOT_FOUND=0; fi
    [ "$NOT_FOUND" -ge 3 ] && break
    kill -0 "$DEV_PID" 2>/dev/null || break
    sleep 5
  done
  if [ "$NOT_FOUND" -ge 3 ]; then
    BROWSER_RESULT="FAILED (/login is 404: stale .next/dev cache — stop next dev, remove .next/dev, run again)"
  elif curl -s -o /dev/null -w "%{http_code}" -m 60 "http://localhost:${PORT}/login" | grep -q 200; then
    step "Browser smoke (screenshots: ${SHOTS})"
    SMOKE_DATA="$(npx tsx scripts/smoke/new-features-setup.ts | tail -1)"
    if SMOKE_DATA="$SMOKE_DATA" SMOKE_BASE_URL="http://localhost:${PORT}" node scripts/smoke/new-features.smoke.cjs "$SHOTS"; then
      BROWSER_RESULT="passed"
    else
      BROWSER_RESULT="FAILED"
      tail -40 "$LOG"
    fi
  else
    BROWSER_RESULT="FAILED (the app did not start)"
    tail -60 "$LOG"
  fi
fi

printf '\n================ smoke:local ================\nDB scenarios:  %s\nBrowser smoke: %s\n' "$DB_RESULT" "$BROWSER_RESULT"
case "$DB_RESULT $BROWSER_RESULT" in
  *FAILED*) exit 1 ;;
esac
echo "RESULT: smoke passed"
