#!/usr/bin/env bash
# Concurrent wallet and call-billing tests. Expects DB $1 migrated; LOCK_KEY $2 is a start barrier.
# Every worker connects first and then blocks on a shared advisory lock, so all statements fire at
# the same instant when the holder releases (real contention, not staggered).
set -u
DB="${1:?FATAL: Missing database argument (arg 1)}"
LOCK_KEY="${2:?FATAL: Missing mandatory concurrency lock argument (arg 2)}"
if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2147483647 ]; then
  echo "FATAL: Invalid concurrency barrier key '$LOCK_KEY'" >&2
  exit 2
fi
cd "$(dirname "$0")"

A=80000000-0000-0000-0000-00000000000a
B=80000000-0000-0000-0000-00000000000b
C=80000000-0000-0000-0000-00000000000c
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/milo_coin_conc_XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: expected $3, got $2"; fail=1; fi; }

psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f 46_coin_concurrency_setup.sql >/dev/null || { echo "FAIL  coin concurrency setup"; exit 1; }

# New accepted call for the funded caller, 50 seconds in, so any extension request is due.
new_call() { # label call_type
  q "
    INSERT INTO public.video_calls(match_id, caller_id, recipient_id, call_type, status, expires_at,
      accepted_at, free_call_until, billing_exempt, billing_rate_coins, billing_free_seconds)
    VALUES ('dddddddd-0000-0000-0000-0000000000c1', '$A', '$B', '$2', 'accepted', now() + interval '1 hour',
      now() - interval '50 seconds', now() + interval '10 seconds', false,
      CASE WHEN '$2' = 'video' THEN 10 ELSE 4 END, 60)
    RETURNING id" | head -1 | { read -r id; q "INSERT INTO public.coin_conc_calls VALUES ('$1', '$id')"; }
}
call_id() { q "SELECT id FROM public.coin_conc_calls WHERE label = '$1'"; }

# Runs N copies of a SQL snippet at the same instant. $1 = output prefix, $2 = N, $3 = role, $4 = SQL
# (__I__ is the worker index; __U__ alternates between the caller A and the recipient B). Each worker writes its single result line to "$OUT_DIR/$prefix.<i>".
burst() {
  local prefix="$1" n="$2" role="$3" sql="$4" i pids=()
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(3)" >/dev/null 2>&1 &
  local holder=$!
  sleep 1
  for i in $(seq 1 "$n"); do
    local stmt="${sql//__I__/$i}" user="$A"
    if (( i % 2 == 0 )); then user="$B"; fi
    stmt="${stmt//__U__/$user}"
    (
      PGOPTIONS="-c lock_timeout=15000 -c statement_timeout=30000" \
      psql -X -q -At -d "$DB" \
        -c "SELECT pg_advisory_lock_shared($LOCK_KEY); SET ROLE $role; SET request.jwt.claim.role='$role'; $stmt" \
        > "$OUT_DIR/$prefix.$i" 2>&1
    ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
  wait "$holder"
}
count_matching() { grep -l -- "$2" "$OUT_DIR"/"$1".* 2>/dev/null | wc -l | tr -d ' '; }

# ---- 1. Parallel extension requests for one call: exactly one minute is charged ----
new_call c1 video
CID=$(call_id c1)
burst ext1 12 service_role "SELECT public.extend_call_coverage('$CID', '$A')"
check "12 parallel extension requests: ledger charge rows" "$(q "SELECT count(*) FROM coin_transactions WHERE call_id='$CID' AND kind='call_charge'")" 1
check "12 parallel extension requests: minutes billed" "$(q "SELECT billed_minutes FROM video_calls WHERE id='$CID'")" 1
check "12 parallel extension requests: caller charged once (100-10)" "$(q "SELECT balance FROM coin_wallets WHERE user_id='$A'")" 90
check "12 parallel extension requests: exactly one reports extended=true" "$(count_matching ext1 '"extended": true')" 1
check "12 parallel extension requests: none failed" "$(count_matching ext1 '"ok": true')" 12

# ---- 2. Both participants request at once ----
new_call c2 video
CID2=$(call_id c2)
# Make the first call inactive so the active-call rule of create_video_call is not at stake (rows are inserted directly).
q "UPDATE video_calls SET status='ended', ended_at=now(), settled_at=now() WHERE id='$CID'" >/dev/null
burst ext2 12 service_role "SELECT public.extend_call_coverage('$CID2', '__U__')"
check "caller and recipient requesting together: one more minute only (2 charges in total)" "$(q "SELECT count(*) FROM coin_transactions WHERE kind='call_charge' AND call_id IN ('$CID','$CID2')")" 2
check "recipient never pays" "$(q "SELECT count(*) FROM coin_wallets WHERE user_id='$B'")" 0

# ---- 3. Overspend: 20 simultaneous 4-coin debits against a 10-coin wallet ----
q "SELECT public.apply_coin_transaction('$C', 'grant', 10, 'conc-fund-c-000001')" >/dev/null
OWNER_ROLE=$(q "SELECT current_user")
burst debit 20 "$OWNER_ROLE" "SELECT public.apply_coin_transaction('$C', 'adjustment', -4, 'conc-debit-c-__I__0000')"
check "20 parallel debits on 10 coins: successes" "$(count_matching debit '"ok": true')" 2
check "20 parallel debits on 10 coins: refusals" "$(count_matching debit 'insufficient_coins')" 18
check "20 parallel debits on 10 coins: final balance" "$(q "SELECT balance FROM coin_wallets WHERE user_id='$C'")" 2
check "20 parallel debits on 10 coins: ledger matches balance" "$(q "SELECT coalesce(sum(amount),0) FROM coin_transactions WHERE user_id='$C'")" 2

# ---- 4. Duplicate verified purchase delivered 15 times in parallel ----
burst purchase 15 service_role "SELECT public.credit_coins_from_purchase('$C', 50, 'ORDER-CONC-0001')"
check "15 parallel duplicate purchase credits: applied once" "$(count_matching purchase '"applied": true')" 1
check "15 parallel duplicate purchase credits: ledger rows" "$(q "SELECT count(*) FROM coin_transactions WHERE idempotency_key='purchase:ORDER-CONC-0001'")" 1
check "15 parallel duplicate purchase credits: balance" "$(q "SELECT balance FROM coin_wallets WHERE user_id='$C'")" 52

# ---- 5. Same idempotency key claimed by two different users at once: one winner ----
burst keyrace_a 1 "$OWNER_ROLE" "SELECT public.apply_coin_transaction('$C', 'grant', 7, 'conc-shared-key-0001')"
q "SELECT 1" >/dev/null
rc_before=$(q "SELECT count(*) FROM coin_transactions WHERE idempotency_key='conc-shared-key-0001'")
check "shared idempotency key: first claim recorded" "$rc_before" 1
burst keyrace_b 6 "$OWNER_ROLE" "SELECT public.apply_coin_transaction('$A', 'grant', 7, 'conc-shared-key-0001')"
check "shared idempotency key: other user can never reuse it" "$(q "SELECT count(*) FROM coin_transactions WHERE idempotency_key='conc-shared-key-0001'")" 1

# ---- 6. Ending the call while extensions are racing: ledger stays consistent ----
new_call c3 video
CID3=$(call_id c3)
q "UPDATE video_calls SET status='ended', ended_at=now(), settled_at=now() WHERE id='$CID2'" >/dev/null
EXTRA_BEFORE=$(q "SELECT balance FROM coin_wallets WHERE user_id='$A'")
psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(3)" >/dev/null 2>&1 &
holder=$!; sleep 1; pids=()
for i in 1 2 3 4; do
  ( psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock_shared($LOCK_KEY); SET ROLE service_role; SELECT public.extend_call_coverage('$CID3', '$A')" > "$OUT_DIR/race.ext.$i" 2>&1 ) & pids+=($!)
done
for i in 1 2 3; do
  ( psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock_shared($LOCK_KEY); UPDATE video_calls SET status='ended', ended_at=now() WHERE id='$CID3' AND status='accepted'" > "$OUT_DIR/race.end.$i" 2>&1 ) & pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done; wait "$holder"
check "extend/end race: call is ended and settled once" "$(q "SELECT status || ':' || (settled_at IS NOT NULL)::text FROM video_calls WHERE id='$CID3'")" "ended:true"
check "extend/end race: at most one refund row" "$(q "SELECT count(*) <= 1 FROM coin_transactions WHERE call_id='$CID3' AND kind='refund'")" t
check "extend/end race: unstarted prepaid minute never kept (net 0)" "$(q "SELECT coalesce(-sum(amount),0) FROM coin_transactions WHERE call_id='$CID3'")" 0
check "extend/end race: call row matches ledger" "$(q "SELECT coins_charged FROM video_calls WHERE id='$CID3'")" 0
check "extend/end race: caller balance unchanged by the raced call" "$(q "SELECT balance FROM coin_wallets WHERE user_id='$A'")" "$EXTRA_BEFORE"

# ---- 7. Global invariants after all the contention ----
check "invariant: wallets equal ledger sums" "$(q "SELECT count(*) FROM coin_wallets w WHERE w.balance <> (SELECT coalesce(sum(amount),0) FROM coin_transactions t WHERE t.user_id=w.user_id)")" 0
check "invariant: no negative wallets" "$(q "SELECT count(*) FROM coin_wallets WHERE balance < 0")" 0
check "invariant: no duplicate idempotency keys" "$(q "SELECT count(*) FROM (SELECT idempotency_key FROM coin_transactions GROUP BY 1 HAVING count(*) > 1) d")" 0
exit $fail
