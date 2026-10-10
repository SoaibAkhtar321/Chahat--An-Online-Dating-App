#!/usr/bin/env bash
# One-command database security/regression suite on a SCRATCH PostgreSQL 16 (never touches Supabase).
# Requires: psql + a local Postgres you can create databases on.
#   PGHOST/PGPORT/PGUSER/PGPASSWORD select the server (defaults: localhost:5432, user postgres).
#   MIGRATIONS_DIR overrides ../migrations (used to prove the suite catches regressions).
# Exit code is non-zero if anything fails. SQL NOTICEs are not failures.
set -u
cd "$(dirname "$0")"
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
MIG="${MIGRATIONS_DIR:-../migrations}"
P="psql -X -q -v ON_ERROR_STOP=1"
status=0

setup_db() {
  local db="$1"
  psql -X -q -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" 2>&1 | grep -v NOTICE
  $P -d "$db" -f 00_supabase_standins.sql || { echo "FAIL: stand-ins"; return 1; }
  for f in "$MIG"/*.sql ../seed.sql; do
    $P -d "$db" -f "$f" >/dev/null 2>/tmp/milo_apply.err || { echo "FAIL: applying $f"; cat /tmp/milo_apply.err; return 1; }
  done
  echo "applied migrations + seed to $db"
}

echo "== functional / RLS / storage / deletion =="
setup_db milo_test_func || exit 1
for f in 10_functional_rls.sql 20_storage_deletion.sql 90_assert.sql; do
  $P -d milo_test_func -f "$f" > /tmp/milo_test.out 2>&1; rc=$?
  [ "$f" = 90_assert.sql ] && cat /tmp/milo_test.out
  if [ $rc -ne 0 ]; then echo "FAIL: $f (exit $rc)"; [ "$f" != 90_assert.sql ] && head -20 /tmp/milo_test.out; status=1; break; fi
done

echo "== concurrency =="
setup_db milo_test_conc || exit 1
$P -d milo_test_conc -f 30_concurrency_setup.sql || { echo "FAIL: concurrency setup"; exit 1; }
bash 40_concurrency.sh milo_test_conc || status=1

[ $status -eq 0 ] && echo "RESULT: ALL DATABASE TESTS PASSED" || echo "RESULT: DATABASE TESTS FAILED"
exit $status
