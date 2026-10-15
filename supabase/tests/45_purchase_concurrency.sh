#!/usr/bin/env bash
# Concurrent purchase replay and cross-account token ownership tests.
# Expects DB $1 migrated and 30_concurrency_setup.sql applied; LOCK_KEY $2 is a test barrier.
set -u
DB="${1:?FATAL: Missing database argument (arg 1)}"
LOCK_KEY="${2:?FATAL: Missing mandatory concurrency lock argument (arg 2)}"

if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2147483647 ]; then
  echo "FATAL: Invalid concurrency barrier key '$LOCK_KEY'" >&2
  exit 2
fi

F=30000000-0000-0000-0000-000000000001
G=30000000-0000-0000-0000-000000000002
H=30000000-0000-0000-0000-000000000003
SAME_TOKEN=$(printf 'a%.0s' {1..64})
CROSS_TOKEN=$(printf 'b%.0s' {1..64})
EXPIRY=2099-11-15T00:00:00Z
TMP_BASE="${TMPDIR:-/tmp}/milo_purchase_concurrency_$$"
OUT1="${TMP_BASE}_1"
OUT2="${TMP_BASE}_2"
OUT3="${TMP_BASE}_3"
OUT4="${TMP_BASE}_4"
trap 'rm -f "$OUT1" "$OUT2" "$OUT3" "$OUT4"' EXIT

q() {
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"
}

purchase_call() {
  local user_id="$1"
  local token_hash="$2"
  PGOPTIONS="-c lock_timeout=10000 -c statement_timeout=20000" \
    psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" \
    -c "SELECT pg_advisory_lock_shared($LOCK_KEY); SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT public.record_verified_google_purchase('$user_id','chahat_premium_1m','$token_hash','GPA.concurrent',(SELECT starts_at FROM public.purchase_concurrency_window),(SELECT expires_at FROM public.purchase_concurrency_window),true,'ACTIVE')" \
    > "$3" 2>&1
}

run_pair() {
  local user1="$1" token1="$2" out1="$3"
  local user2="$4" token2="$5" out2="$6"
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(4)" >/dev/null 2>&1 &
  local holder=$!
  sleep 1
  purchase_call "$user1" "$token1" "$out1" &
  local first=$!
  purchase_call "$user2" "$token2" "$out2" &
  local second=$!
  wait "$first"
  local first_status=$?
  wait "$second"
  local second_status=$?
  wait "$holder"
  echo "$first_status $second_status"
}

fail=0
check() {
  if [ "$2" = "$3" ]; then
    echo "PASS  $1 ($2)"
  else
    echo "FAIL  $1: expected $3, got $2"
    fail=1
  fi
}

same_status=$(run_pair "$F" "$SAME_TOKEN" "$OUT1" "$F" "$SAME_TOKEN" "$OUT2")
same_successes=$(printf '%s\n' "$same_status" | tr ' ' '\n' | grep -c '^0$')
check "same-account concurrent retries both succeed" "$same_successes" 2
check "same-account concurrent retries create one order" \
  "$(q "SELECT count(*) FROM public.subscription_orders WHERE token_hash='$SAME_TOKEN'")" 1
check "same-account concurrent retries leave one subscription" \
  "$(q "SELECT count(*) FROM public.user_subscriptions WHERE user_id='$F'")" 1
check "same-account concurrent retry is explicitly idempotent" \
  "$(grep -c '"idempotent": true' "$OUT1" "$OUT2" | awk -F: '{sum += $NF} END {print sum+0}')" 1

cross_status=$(run_pair "$G" "$CROSS_TOKEN" "$OUT3" "$H" "$CROSS_TOKEN" "$OUT4")
cross_successes=$(printf '%s\n' "$cross_status" | tr ' ' '\n' | grep -c '^0$')
check "cross-account concurrent token replay grants exactly once" "$cross_successes" 1
check "cross-account concurrent token replay creates one order" \
  "$(q "SELECT count(*) FROM public.subscription_orders WHERE token_hash='$CROSS_TOKEN'")" 1
check "cross-account concurrent token replay grants one account" \
  "$(q "SELECT count(*) FROM public.user_subscriptions WHERE user_id IN ('$G','$H')")" 1

exit "$fail"
