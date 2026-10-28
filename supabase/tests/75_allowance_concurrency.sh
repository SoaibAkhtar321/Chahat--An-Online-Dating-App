#!/usr/bin/env bash
# Concurrency for the daily call allowance (20260101005800/006000) and Premium rewind:
# simultaneous call attempts, duplicate accepts, parallel join grants, duplicate Agora events, parallel undo.
# Expects DB $1 migrated; LOCK_KEY $2 is a start barrier (see 46_coin_concurrency.sh).
set -u
DB="${1:?FATAL: Missing database argument (arg 1)}"
LOCK_KEY="${2:?FATAL: Missing mandatory concurrency lock argument (arg 2)}"
if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2147483647 ]; then
  echo "FATAL: Invalid concurrency barrier key '$LOCK_KEY'" >&2; exit 2
fi
cd "$(dirname "$0")"
A=75000000-0000-0000-0000-00000000000a
B=75000000-0000-0000-0000-00000000000b
E=75000000-0000-0000-0000-00000000000e
F=75000000-0000-0000-0000-00000000000f
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/milo_allow_conc_XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: expected $3, got $2"; fail=1; fi; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f 75_allowance_concurrency_setup.sql >/dev/null || { echo "FAIL  allowance concurrency setup"; exit 1; }

fire() {
  local prefix="$1" n="$2" hold="$3" sql="$4" i pids=()
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep($hold)" >/dev/null 2>&1 &
  local holder=$!
  sleep 0.5
  for i in $(seq 1 "$n"); do
    ( PGOPTIONS="-c lock_timeout=15000 -c statement_timeout=30000" \
      psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock_shared($LOCK_KEY); ${sql//__I__/$i}" \
      > "$OUT_DIR/$prefix.$i" 2>&1 ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
  wait "$holder"
}

# ---- 1. 12 simultaneous call attempts by one free caller to three different matches ----
MATCHES=(75aaaaaa-0000-0000-0000-0000000000b1 75aaaaaa-0000-0000-0000-0000000000c1 75aaaaaa-0000-0000-0000-0000000000d1)
fire create 12 2 "SET ROLE authenticated; SET request.jwt.claim.sub='$A'; SELECT public.create_video_call((ARRAY['${MATCHES[0]}','${MATCHES[1]}','${MATCHES[2]}']::uuid[])[1 + __I__ % 3], 'video')"
check "12 parallel call attempts: exactly one live call for the caller" \
  "$(q "SELECT count(*) FROM video_calls WHERE caller_id='$A' AND status IN ('pending','accepted')")" 1

# Accept it from the right recipient, 10 duplicate accepts at once.
CALL=$(q "SELECT id FROM video_calls WHERE caller_id='$A' AND status='pending'")
RCPT=$(q "SELECT recipient_id FROM video_calls WHERE id='$CALL'")
fire accept 10 2 "SET ROLE authenticated; SET request.jwt.claim.sub='$RCPT'; SELECT public.transition_video_call('$CALL', 'accept')"
check "10 parallel duplicate accepts: one accepted call with the full 30 s grant" \
  "$(q "SELECT count(*) FROM video_calls WHERE id='$CALL' AND status='accepted' AND billing_free_seconds=30")" 1
check "10 parallel duplicate accepts: no coins charged" \
  "$(q "SELECT count(*) FROM coin_transactions WHERE call_id='$CALL'")" 0

# ---- 2. 16 parallel token requests (8 per participant): clock starts once, window never exceeds the grant ----
fire grant 16 2 "SET ROLE service_role; SELECT public.get_call_join_context('$CALL', CASE WHEN __I__ % 2 = 0 THEN '$A'::uuid ELSE '$RCPT'::uuid END)"
check "16 parallel join grants: clock started exactly once, window = start + 30 s" \
  "$(q "SELECT count(*) FROM video_calls WHERE id='$CALL' AND allowance_started_at IS NOT NULL AND abs(extract(epoch FROM free_call_until - allowance_started_at) - 30) < 0.001")" 1

# A second call cannot start while this one is live (multiple devices / app restarts all hit the same rule).
q "SET ROLE authenticated; SET request.jwt.claim.sub='$A'; SELECT public.create_video_call('${MATCHES[0]}', 'video')" > "$OUT_DIR/second" 2>&1
check "second call while one is live is refused" "$(grep -c 'already has an active call' "$OUT_DIR/second")" 1

# ---- 3. 12 deliveries of the same Agora event at once: stored once ----
TS=$(q "SELECT extract(epoch FROM now())::bigint")
fire ncs 12 2 "SET ROLE service_role; SELECT public.record_agora_channel_event('dup-notice', 107, 'call_$CALL', '$A', 1, $TS)"
check "12 parallel duplicate Agora events: one row" "$(q "SELECT count(*) FROM call_media_events WHERE notice_id='dup-notice'")" 1

# ---- 4. 10 parallel Premium undo requests for the same pass: exactly one succeeds ----
fire undo 10 2 "SET ROLE authenticated; SET request.jwt.claim.sub='$E'; SELECT public.undo_swipe_pass('$F')->>'undone'"
check "10 parallel rewinds: exactly one reports undone" "$(cat "$OUT_DIR"/undo.* | grep -c '^true$')" 1
check "10 parallel rewinds: the pass is gone" "$(q "SELECT count(*) FROM swipes WHERE from_id='$E' AND to_id='$F'")" 0

exit $fail
