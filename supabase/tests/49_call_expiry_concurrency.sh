#!/usr/bin/env bash
# Expiry concurrency: duplicate scheduler runs and expiry-versus-accept races.
# Expects DB $1 migrated; LOCK_KEY $2 is a start barrier (see 46_coin_concurrency.sh).
set -u
DB="${1:?FATAL: Missing database argument (arg 1)}"
LOCK_KEY="${2:?FATAL: Missing mandatory concurrency lock argument (arg 2)}"
if ! [[ "$LOCK_KEY" =~ ^[1-9][0-9]{3,9}$ ]] || [ "$LOCK_KEY" -gt 2147483647 ]; then
  echo "FATAL: Invalid concurrency barrier key '$LOCK_KEY'" >&2; exit 2
fi
cd "$(dirname "$0")"
A=92000000-0000-0000-0000-00000000000a
B=92000000-0000-0000-0000-00000000000b
M=dddddddd-0000-0000-0000-0000000000f1
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/milo_exp_conc_XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: expected $3, got $2"; fail=1; fi; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f 49_call_expiry_concurrency_setup.sql >/dev/null || { echo "FAIL  expiry concurrency setup"; exit 1; }

# Starts N workers that all fire when the barrier holder releases (HOLD seconds after it starts).
# $1 prefix, $2 workers, $3 hold seconds, $4 SQL (run as the stated role). Output per worker in $OUT_DIR.
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

# ---- 1. 12 schedulers at once over 20 lapsed accepted calls + 1 abandoned pending call ----
q "INSERT INTO video_calls(match_id, caller_id, recipient_id, call_type, status, expires_at, accepted_at, free_call_until, billing_exempt, billing_free_seconds)
   SELECT '$M', '$A', '$B', 'audio', 'accepted', now() + interval '1 hour', now() - interval '90 seconds', now() - interval '30 seconds', false, 60
   FROM generate_series(1, 20)" >/dev/null
q "INSERT INTO video_calls(match_id, caller_id, recipient_id, call_type, expires_at)
   VALUES ('$M', '$A', '$B', 'video', now() - interval '1 second')" >/dev/null
fire sweep 12 2 "SET ROLE service_role; SELECT public.expire_video_calls()"
check "12 parallel sweepers: every lapsed accepted call ended" "$(q "SELECT count(*) FROM video_calls WHERE match_id='$M' AND status='ended'")" 20
check "12 parallel sweepers: every ended call settled exactly once" "$(q "SELECT count(*) FROM video_calls WHERE match_id='$M' AND status='ended' AND settled_at IS NOT NULL AND duration_seconds BETWEEN 59 AND 61")" 20
check "12 parallel sweepers: abandoned pending call timed out" "$(q "SELECT count(*) FROM video_calls WHERE match_id='$M' AND status='timed_out'")" 1
check "12 parallel sweepers: nothing left pending or accepted" "$(q "SELECT count(*) FROM video_calls WHERE match_id='$M' AND status IN ('pending','accepted')")" 0
check "12 parallel sweepers: one ended event per participant per call" "$(q "SELECT count(*) FROM (SELECT call_id, user_id FROM call_events WHERE event='ended' AND call_id IN (SELECT id FROM video_calls WHERE match_id='$M') GROUP BY 1,2 HAVING count(*) <> 1) x")" 0
check "12 parallel sweepers: total ended events" "$(q "SELECT count(*) FROM call_events WHERE event='ended' AND call_id IN (SELECT id FROM video_calls WHERE match_id='$M')")" 40
check "12 parallel sweepers: timed_out events" "$(q "SELECT count(*) FROM call_events WHERE event='timed_out' AND call_id IN (SELECT id FROM video_calls WHERE match_id='$M')")" 2

# ---- 2. Expiry versus accept at the expiry boundary: exactly one outcome per call ----
accepted_n=0; timedout_n=0; bad=0
for off in 2700 2900 3000 3100 3150 3250 3400 3600; do
  ID=$(q "INSERT INTO video_calls(match_id, caller_id, recipient_id, call_type, expires_at)
          VALUES ('$M', '$A', '$B', 'audio', now() + interval '$off milliseconds') RETURNING id" | head -1)
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock($LOCK_KEY); SELECT pg_sleep(3)" >/dev/null 2>&1 &
  holder=$!; sleep 0.5; pids=()
  for w in accept1 accept2 sweep1 sweep2; do
    # One -c per statement: each is its own transaction, so now() is read AFTER the barrier opens.
    case "$w" in
      accept*) args=(-c "SELECT pg_advisory_lock_shared($LOCK_KEY)" -c "SET ROLE authenticated" -c "SET request.jwt.claim.sub='$B'" -c "SELECT public.transition_video_call('$ID', 'accept')");;
      *)       args=(-c "SELECT pg_advisory_lock_shared($LOCK_KEY)" -c "SET ROLE service_role" -c "SELECT public.expire_video_calls()");;
    esac
    ( psql -X -q -At -d "$DB" "${args[@]}" > "$OUT_DIR/race.$off.$w" 2>&1 ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid"; done; wait "$holder"
  st=$(q "SELECT status FROM video_calls WHERE id='$ID'")
  acc=$(q "SELECT count(*) FROM call_events WHERE call_id='$ID' AND event='accepted'")
  tmo=$(q "SELECT count(*) FROM call_events WHERE call_id='$ID' AND event='timed_out'")
  if [ "$st" = "accepted" ] && [ "$acc" = 2 ] && [ "$tmo" = 0 ]; then accepted_n=$((accepted_n+1))
  elif [ "$st" = "timed_out" ] && [ "$acc" = 0 ] && [ "$tmo" = 2 ]; then timedout_n=$((timedout_n+1))
  else bad=$((bad+1)); echo "  inconsistent outcome at +${off}ms: status=$st accepted_events=$acc timed_out_events=$tmo"; fi
  q "UPDATE video_calls SET status='ended', ended_at=now() WHERE id='$ID' AND status='accepted'" >/dev/null
done
check "expiry/accept race: every call has exactly one consistent outcome" "$bad" 0
echo "INFO  expiry/accept race outcomes: accepted=$accepted_n timed_out=$timedout_n"
check "expiry/accept race: no call left pending" "$(q "SELECT count(*) FROM video_calls WHERE match_id='$M' AND status='pending'")" 0

[ "$fail" = 0 ] || exit 1
exit 0
