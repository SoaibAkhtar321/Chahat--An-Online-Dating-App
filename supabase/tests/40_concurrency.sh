#!/usr/bin/env bash
# Parallel-session tests. Expects DB $1 already migrated and seeded with 30_concurrency_setup.sql.
set -u
DB="${1:?FATAL: Missing database argument (arg 1)}"
LOCK_KEY="${2:?FATAL: Missing mandatory concurrency lock argument (arg 2)}"

if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2147483647 ]; then
  echo "FATAL: LOCK_KEY must be a positive 32-bit integer (1000..2147483647). Received: '$LOCK_KEY'" >&2
  exit 2
fi

# Barrier: a holder session keeps an exclusive advisory lock; every worker connects first, then blocks on the
# shared lock, so all swipes fire at the same instant when the holder releases (real contention, not staggered).
swipe() { psql -X -q -At -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub='$1'; SET request.jwt.claim.role='authenticated'; SELECT pg_advisory_lock_shared($LOCK_KEY); SELECT public.record_swipe('$2','$3')" >/dev/null 2>&1; }
export -f swipe; export DB LOCK_KEY
burst() { # reads "uid target kind" lines on stdin, fires them simultaneously
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(4)" >/dev/null 2>&1 &
  local holder=$!; sleep 1; local pids=()
  while read -r u t k; do swipe "$u" "$t" "$k" & pids+=($!); done
  wait "${pids[@]}" "$holder"
}
F=10000000-0000-0000-0000-000000000001; G=10000000-0000-0000-0000-000000000027
q() { psql -X -q -At -d "$DB" -c "$1"; }
fail=0; check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: expected $3, got $2"; fail=1; fi; }

# Pin the daily like limit to 10 so the burst test is independent of the production default (20).
q "insert into app_settings(key,value) values ('daily_like_limit','10'::jsonb) on conflict (key) do update set value=excluded.value" >/dev/null
# Pre-create today's quota row (one sequential like) so the burst contends on the existing row's limit check,
# not on the first-insert path, which would serialise the workers and hide a missing row lock.
echo "$F 10000000-0000-0000-0000-000000000002 like" | burst
for g in $(seq 3 27); do echo "$F 10000000-0000-0000-0000-$(printf %012d $g) like"; done | burst
check "25 parallel likes capped by daily limit: quota used" "$(q "select likes_used from user_daily_quotas where user_id='$F'")" 10
check "25 parallel likes capped by daily limit: swipe rows" "$(q "select count(*) from swipes where from_id='$F'")" 10

q "delete from swipes where from_id='$F'; delete from user_daily_quotas where user_id='$F'" >/dev/null
for _ in $(seq 1 15); do echo "$F $G like"; done | burst
check "15 parallel duplicate likes: quota used" "$(q "select likes_used from user_daily_quotas where user_id='$F'")" 1
check "15 parallel duplicate likes: swipe rows" "$(q "select count(*) from swipes where from_id='$F' and to_id='$G'")" 1

for i in $(seq 1 10); do
  M=20000000-0000-0000-0000-$(printf %012d $i); W=20000000-0000-0000-0000-$(printf %012d $((i+10)))
  echo "$M $W like"; echo "$W $M like"
done | burst
check "10 simultaneous mutual-like pairs: matches" "$(q "select count(*) from matches where user_a like '20%'")" 10
check "no duplicate matches" "$(q "select count(*) from (select user_a,user_b from matches group by 1,2 having count(*)>1) d")" 0

purchase() {
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c \
    "SET ROLE service_role; SELECT pg_advisory_lock_shared($LOCK_KEY);
     SELECT public.record_verified_google_purchase(
       '$1', 'chahat_premium_1m', '$2', 'concurrent-order',
       (SELECT starts_at FROM public.purchase_concurrency_window),
       (SELECT expires_at FROM public.purchase_concurrency_window), true, 'ACTIVE'
     )" >/dev/null 2>&1
}
export -f purchase
export DB LOCK_KEY
purchase_burst() {
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(4)" >/dev/null 2>&1 &
  local holder=$!; sleep 1; local pids=(); local failed=0
  for _ in $(seq 1 12); do purchase "$F" "$(printf '%064d' 7)" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  wait "$holder" || failed=1
  return "$failed"
}
if purchase_burst; then
  check "12 parallel same-account purchase retries: order rows" "$(q "select count(*) from subscription_orders where token_hash='$(printf '%064d' 7)'")" 1
  check "12 parallel same-account purchase retries: premium entitlement" "$(q "select count(*) from user_subscriptions where user_id='$F' and tier='premium' and status='active'")" 1
else
  echo "FAIL  concurrent same-account purchase retry returned an error"
  fail=1
fi

cross_account_purchase() {
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c \
    "SET ROLE service_role; SELECT pg_advisory_lock_shared($LOCK_KEY);
     SELECT public.record_verified_google_purchase(
       '$1', 'chahat_premium_1m', '$(printf '%064d' 8)', 'cross-account-order',
       (SELECT starts_at FROM public.purchase_concurrency_window),
       (SELECT expires_at FROM public.purchase_concurrency_window), true, 'ACTIVE'
     )" >/dev/null 2>&1
}
export -f cross_account_purchase
psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(4)" >/dev/null 2>&1 &
purchase_holder=$!; sleep 1
cross_account_purchase "$F" & cross_a=$!
cross_account_purchase "$G" & cross_b=$!
wait "$cross_a"; cross_a_rc=$?
wait "$cross_b"; cross_b_rc=$?
wait "$purchase_holder"
if { [ "$cross_a_rc" -eq 0 ] && [ "$cross_b_rc" -ne 0 ]; } || { [ "$cross_a_rc" -ne 0 ] && [ "$cross_b_rc" -eq 0 ]; }; then
  check "cross-account concurrent token replay: single order owner" "$(q "select count(*) from subscription_orders where token_hash='$(printf '%064d' 8)'")" 1
else
  echo "FAIL  cross-account concurrent replay must yield exactly one successful owner"
  fail=1
fi
exit $fail
