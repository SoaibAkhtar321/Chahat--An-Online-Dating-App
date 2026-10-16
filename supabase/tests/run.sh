#!/usr/bin/env bash
# One-command database security/regression suite on a SCRATCH PostgreSQL 16 (never touches Supabase).
# Requires: psql + a local disposable Postgres instance with the sentinel comment.
# Exit code is non-zero if anything fails. SQL NOTICEs are not failures.
set -u
cd "$(dirname "$0")"

# 1. Environment Sanitization: prevent inherited libpq variables from redirecting connections
unset PGDATABASE PGSERVICE PGSERVICEFILE DATABASE_URL PGOPTIONS PGSSLMODE

# 2. Connection Parameters
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-postgres}"

case "$PGHOST" in
  localhost|127.0.0.1|::1|/*) ;;
  *) [ "${ALLOW_NONLOCAL_DB:-}" = "1" ] || { echo "REFUSING to run against non-local PGHOST=$PGHOST (set ALLOW_NONLOCAL_DB=1 only for a disposable server)"; exit 2; } ;;
esac

# Guard against accidental default port targeting
if [ "$PGPORT" = "5432" ] && [ "${ALLOW_DANGEROUS_DEFAULT_PORT:-0}" != "1" ]; then
  echo "FAIL-CLOSED: Refusing to run tests against default PostgreSQL port 5432." >&2
  echo "Tests must target a dedicated container port (e.g. PGPORT=5433). Set ALLOW_DANGEROUS_DEFAULT_PORT=1 to override." >&2
  exit 2
fi

# 3. Dedicated Administrative Wrapper bound strictly to 'postgres' database
psql_admin() {
  psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres "$@"
}

# 4. Target Connection Handshake
TARGET_INFO=$(psql_admin -At -c "SELECT current_user, current_database();" 2>/dev/null) || {
  echo "FAIL-CLOSED: Could not connect to PostgreSQL target on ${PGHOST}:${PGPORT} as user ${PGUSER}." >&2
  exit 2
}
if [ "$TARGET_INFO" != "${PGUSER}|postgres" ]; then
  echo "FAIL-CLOSED: Unexpected connection target: '$TARGET_INFO' (expected ${PGUSER}|postgres)." >&2
  exit 2
fi

# 5. Supplementary Sentinel Check on 'postgres' database
SENTINEL=$(psql_admin -At -c "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = 'postgres';" 2>/dev/null)
if [ "$SENTINEL" != "milo_disposable_test_cluster" ]; then
  echo "FAIL-CLOSED: Target PostgreSQL cluster lacks 'milo_disposable_test_cluster' sentinel on database 'postgres'." >&2
  echo "Refusing destructive test run against unverified cluster." >&2
  exit 2
fi

# 6. Strict Initial Allowlist Check: only standard system databases allowed before test creation
UNEXPECTED_DBS=$(psql_admin -At -c "
  SELECT datname FROM pg_database 
  WHERE datname NOT IN ('postgres', 'template0', 'template1');
" 2>/dev/null)

if [ -n "$UNEXPECTED_DBS" ]; then
  echo "FAIL-CLOSED: Target cluster contains foreign or uncleaned database(s):" >&2
  echo "$UNEXPECTED_DBS" >&2
  echo "A clean disposable cluster must contain ONLY standard system databases ('postgres', 'template0', 'template1')." >&2
  exit 2
fi

# 7. Collision-Resistant Run Identifier & Database Names
RAND_HEX=$(od -An -N4 -tx4 /dev/urandom 2>/dev/null | tr -d ' ' || echo "$RANDOM$RANDOM")
RUN_ID="m_${RAND_HEX}_${$}_$(date +%s)"
FUNC_DB="${RUN_ID}_f"
CONC_DB="${RUN_ID}_c"

if [ "${#FUNC_DB}" -gt 63 ] || [ "${#CONC_DB}" -gt 63 ]; then
  echo "FATAL: Database identifier exceeds PostgreSQL 63-byte limit." >&2
  exit 2
fi
if ! [[ "$FUNC_DB" =~ ^[a-z_][a-z0-9_]*$ ]] || ! [[ "$CONC_DB" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "FATAL: Database identifier contains invalid characters." >&2
  exit 2
fi

# Pre-existing Database Collision Check
EXISTS_CHECK=$(psql_admin -At -c "SELECT count(*) FROM pg_database WHERE datname IN ('$FUNC_DB', '$CONC_DB');" 2>/dev/null)
if [ "$EXISTS_CHECK" != "0" ]; then
  echo "FAIL-CLOSED: Database collision detected for '$FUNC_DB' or '$CONC_DB'. Aborting without overwrite." >&2
  exit 2
fi

# 8. Overflow-Safe Concurrency Lock Key Generation via PostgreSQL Engine
LOCK_KEY=$(psql_admin -At -c "SELECT (abs(hashtext('$RUN_ID')::bigint) % 2000000000) + 1000;" 2>/dev/null)
if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2000000999 ]; then
  echo "FATAL: Generated invalid lock key: '$LOCK_KEY'" >&2
  exit 2
fi

# 9. Test Execution Configuration
MIG="${MIGRATIONS_DIR:-../migrations}"

psql_test() {
  local target_db="$1"; shift
  psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target_db" "$@"
}

setup_db() {
  local db="$1"
  psql_admin -c "CREATE DATABASE \"$db\"" 2>&1 | grep -v NOTICE
  psql_test "$db" -f 00_supabase_standins.sql || { echo "FAIL: stand-ins"; return 1; }
  local files=("$MIG"/*.sql); [ -f ../seed.sql ] && files+=(../seed.sql)
  [ -e "${files[0]}" ] || { echo "FAIL: no migrations found in $MIG"; return 1; }
  for f in "${files[@]}"; do
    local err_file="/tmp/${RUN_ID}_apply_${f##*/}.err"
    psql_test "$db" -f "$f" >/dev/null 2>"$err_file" || {
      echo "FAIL: applying migration ${f##*/}" >&2
      cat "$err_file" >&2
      return 1
    }
  done
  echo "applied migrations + seed to $db"
}

# 10. Functional / RLS / Storage / Deletion Suite (Fail-Fast)
echo "== functional / RLS / storage / deletion =="
setup_db "$FUNC_DB" || exit 1
for f in 10_functional_rls.sql 20_storage_deletion.sql 25_photo_reviews.sql 27_photo_visibility.sql 28_security_foundations.sql 29_phase789_lifecycle.sql 35_uniform_quota.sql 36_purchase_verification.sql 37_profile_media.sql 38_push_notifications.sql 39_location_discovery.sql 40_video_calls.sql 41_google_play_verification.sql 42_call_tokens.sql 43_coin_billing.sql 44_voice_messages.sql 47_chat_media_paths.sql 90_assert.sql; do
  out_file="/tmp/${RUN_ID}_test_${f}.out"
  psql_test "$FUNC_DB" -f "$f" > "$out_file" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "FAIL: $f (exit code $rc)" >&2
    echo "=== Failure Output ($out_file) ===" >&2
    cat "$out_file" >&2
    echo "==================================" >&2
    echo "ABORTING: Preserving databases '$FUNC_DB' and '$CONC_DB'. Concurrency suite skipped." >&2
    exit $rc
  fi
  [ "$f" = 90_assert.sql ] && cat "$out_file"
done

# 11. Concurrency Suite (Fail-Fast)
echo "== concurrency =="
setup_db "$CONC_DB" || exit 1
psql_test "$CONC_DB" -f 30_concurrency_setup.sql || { echo "FAIL: concurrency setup"; exit 1; }
bash 40_concurrency.sh "$CONC_DB" "$LOCK_KEY"
conc_rc=$?
if [ $conc_rc -ne 0 ]; then
  echo "FAIL: Concurrency tests failed (exit code $conc_rc)" >&2
  echo "ABORTING: Preserving databases '$FUNC_DB' and '$CONC_DB'." >&2
  exit $conc_rc
fi
bash 45_purchase_concurrency.sh "$CONC_DB" "$LOCK_KEY"
purchase_conc_rc=$?
if [ $purchase_conc_rc -ne 0 ]; then
  echo "FAIL: Purchase concurrency tests failed (exit code $purchase_conc_rc)" >&2
  echo "ABORTING: Preserving databases '$FUNC_DB' and '$CONC_DB'." >&2
  exit $purchase_conc_rc
fi
bash 46_coin_concurrency.sh "$CONC_DB" "$LOCK_KEY"
coin_conc_rc=$?
if [ $coin_conc_rc -ne 0 ]; then
  echo "FAIL: Coin wallet concurrency tests failed (exit code $coin_conc_rc)" >&2
  echo "ABORTING: Preserving databases '$FUNC_DB' and '$CONC_DB'." >&2
  exit $coin_conc_rc
fi
# 12. Isolated Cleanup (Only drops current run's exact databases; never masks test status)
echo "All tests passed cleanly. Cleaning up run-specific databases..."
psql_admin -c "DROP DATABASE \"$FUNC_DB\";" -c "DROP DATABASE \"$CONC_DB\";" >/dev/null 2>&1
cleanup_rc=$?
if [ $cleanup_rc -ne 0 ]; then
  echo "WARNING: All tests passed, but cleanup failed to drop databases." >&2
  echo "Databases retained on cluster: '$FUNC_DB', '$CONC_DB'" >&2
  exit 3
fi

echo "RESULT: ALL DATABASE TESTS PASSED"
exit 0
