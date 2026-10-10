#!/usr/bin/env bash
# Parallel-session tests. Expects DB $1 already migrated and seeded with 30_concurrency_setup.sql.
set -u
DB="$1"
# Barrier: a holder session keeps an exclusive advisory lock; every worker connects first, then blocks on the
# shared lock, so all swipes fire at the same instant when the holder releases (real contention, not staggered).
swipe() { psql -X -q -At -d "$DB" -c "SET ROLE authenticated; SET request.jwt.claim.sub='$1'; SET request.jwt.claim.role='authenticated'; SELECT pg_advisory_lock_shared(777); SELECT public.record_swipe('$2','$3')" >/dev/null 2>&1; }
export -f swipe; export DB
burst() { # reads "uid target kind" lines on stdin, fires them simultaneously
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock(777); SELECT pg_sleep(4)" >/dev/null 2>&1 &
  local holder=$!; sleep 1; local pids=()
  while read -r u t k; do swipe "$u" "$t" "$k" & pids+=($!); done
  wait "${pids[@]}" "$holder"
}
F=10000000-0000-0000-0000-000000000001; G=10000000-0000-0000-0000-000000000027
q() { psql -X -q -At -d "$DB" -c "$1"; }
fail=0; check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: expected $3, got $2"; fail=1; fi; }

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
exit $fail
