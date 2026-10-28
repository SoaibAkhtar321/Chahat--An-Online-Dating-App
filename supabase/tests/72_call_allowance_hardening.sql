\set ON_ERROR_STOP on
-- 20260101005800: free 30 s / premium 300 s daily allowance, join-grant clock (closes the "never report
-- connected" bypass), get_my_video_call_allowance, and Premium rewind eligibility.
-- Runs after 43/50/70 (reuses t_calls, t_json, t_results, expect_fail, test_complete_profile).
-- Production-like settings: 30 s connect grace, default allowance values from the migration.
INSERT INTO public.app_settings (key, value) VALUES
  ('call_daily_allowance_enabled', '1'::jsonb), ('call_free_daily_seconds', '30'::jsonb),
  ('call_premium_daily_seconds', '300'::jsonb), ('call_connect_grace_seconds', '30'::jsonb),
  ('call_join_slack_seconds', '0'::jsonb), ('call_extension_lead_seconds', '20'::jsonb),
  ('call_rate_video_coins_per_minute', '10'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Shift EVERY timestamp of a call back by _secs (simulates time passing, as the table owner).
CREATE FUNCTION public.t72_shift(_label text, _secs integer) RETURNS void LANGUAGE sql AS $$
  UPDATE public.video_calls SET
    created_at = created_at - make_interval(secs => _secs),
    accepted_at = accepted_at - make_interval(secs => _secs),
    free_call_until = free_call_until - make_interval(secs => _secs),
    caller_join_granted_at = caller_join_granted_at - make_interval(secs => _secs),
    recipient_join_granted_at = recipient_join_granted_at - make_interval(secs => _secs),
    allowance_started_at = allowance_started_at - make_interval(secs => _secs),
    caller_connected_at = caller_connected_at - make_interval(secs => _secs),
    recipient_connected_at = recipient_connected_at - make_interval(secs => _secs),
    connected_at = connected_at - make_interval(secs => _secs)
  WHERE id = (SELECT id FROM public.t_calls WHERE label = _label);
$$;
CREATE FUNCTION public.t72_used(_uid uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT public.call_allowance_used_today(_uid);
$$;
-- Start a call as _caller on _match and accept it as _recipient; returns nothing, stores the call under _label.
CREATE FUNCTION public.t72_call(_label text, _match uuid, _caller uuid, _recipient uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _caller::text, true);
  _id := (public.create_video_call(_match, 'video')->>'call_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', _recipient::text, true);
  INSERT INTO public.t_json SELECT 'acc_' || _label, public.transition_video_call(_id, 'accept');
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.t_calls VALUES (_label, _id);
END $$;
CREATE FUNCTION public.t72_end(_label text, _who uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _who::text, true);
  PERFORM public.transition_video_call((SELECT id FROM public.t_calls WHERE label = _label), 'end');
  PERFORM set_config('role', 'postgres', true);
END $$;
CREATE FUNCTION public.t72_id(_label text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.t_calls WHERE label = _label;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('72000000-0000-0000-0000-00000000000a', 'h72-a@x'),   -- free caller
  ('72000000-0000-0000-0000-00000000000b', 'h72-b@x'),   -- recipient
  ('72000000-0000-0000-0000-00000000000c', 'h72-c@x'),   -- premium caller
  ('72000000-0000-0000-0000-00000000000d', 'h72-d@x'),   -- recipient
  ('72000000-0000-0000-0000-00000000000e', 'h72-e@x'),   -- expired-premium caller
  ('72000000-0000-0000-0000-00000000000f', 'h72-f@x'),   -- recipient
  ('72000000-0000-0000-0000-000000000011', 'h72-g@x');   -- stranger
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000a', 'H72A', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000b', 'H72B', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000c', 'H72C', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000d', 'H72D', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000e', 'H72E', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('72000000-0000-0000-0000-00000000000f', 'H72F', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000011', 'H72G', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('72aaaaaa-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000b'),
  ('72aaaaaa-0000-0000-0000-0000000000a2', '72000000-0000-0000-0000-00000000000c', '72000000-0000-0000-0000-00000000000d'),
  ('72aaaaaa-0000-0000-0000-0000000000a3', '72000000-0000-0000-0000-00000000000e', '72000000-0000-0000-0000-00000000000f');
INSERT INTO public.user_subscriptions(user_id, tier, status, starts_at, expires_at) VALUES
  ('72000000-0000-0000-0000-00000000000c', 'plus', 'active', now() - interval '1 day', now() + interval '10 days'),
  ('72000000-0000-0000-0000-00000000000e', 'premium', 'active', now() - interval '10 days', now() - interval '1 minute');

-- ================= A. get_my_video_call_allowance =================
SET ROLE anon;
CALL public.expect_fail('allowance RPC: anon cannot read any allowance', $q$SELECT public.get_my_video_call_allowance()$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'al_free', public.get_my_video_call_allowance();
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_json SELECT 'al_prem', public.get_my_video_call_allowance();
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000e';
INSERT INTO public.t_json SELECT 'al_expired', public.get_my_video_call_allowance();
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance RPC: free member gets 30 s/day, all available',
  result->>'is_free' = 'true' AND (result->>'daily_limit_seconds')::int = 30
    AND (result->>'seconds_remaining')::int = 30 AND result->>'status' = 'available'
    AND (result->>'next_renewal_at')::timestamptz > now()
    AND (result->>'next_renewal_at')::timestamptz <= now() + interval '24 hours', result::text
FROM public.t_json WHERE label = 'al_free';
INSERT INTO public.t_results SELECT 'allowance RPC: paid member (plus) gets 300 s/day',
  result->>'is_free' = 'false' AND (result->>'daily_limit_seconds')::int = 300 AND result->>'tier' = 'plus', result::text
FROM public.t_json WHERE label = 'al_prem';
INSERT INTO public.t_results SELECT 'allowance RPC: an expired subscription falls back to the free 30 s',
  result->>'is_free' = 'true' AND (result->>'daily_limit_seconds')::int = 30, result::text
FROM public.t_json WHERE label = 'al_expired';
INSERT INTO public.t_results SELECT 'allowance RPC: next renewal is midnight IST',
  to_char(timezone('Asia/Kolkata', (result->>'next_renewal_at')::timestamptz), 'HH24:MI:SS') = '00:00:00', result->>'next_renewal_at'
FROM public.t_json WHERE label = 'al_free';

-- ================= B. Join grants =================
SELECT public.t72_call('j1', '72aaaaaa-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'accept: free caller is granted the full 30 s (plus connect grace)',
  billing_free_seconds = 30 AND NOT billing_exempt AND allowance_started_at IS NULL
    AND extract(epoch FROM free_call_until - accepted_at) BETWEEN 59 AND 61, billing_free_seconds::text
FROM public.video_calls WHERE id = public.t72_id('j1');

SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('join context: members cannot call the service-only RPC directly',
  $q$SELECT public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-00000000000a')$q$);
RESET ROLE;

-- A stranger is refused and records nothing.
INSERT INTO public.t_json SELECT 'j1_stranger',
  public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-000000000011');
INSERT INTO public.t_results SELECT 'join context: a non-participant gets found=false and no grant is recorded',
  (SELECT result->>'found' FROM public.t_json WHERE label = 'j1_stranger') = 'false'
    AND caller_join_granted_at IS NULL AND recipient_join_granted_at IS NULL, ''
FROM public.video_calls WHERE id = public.t72_id('j1');

-- Recipient joins; caller has not yet. The clock does not start.
SELECT public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'join grants: one participant joining does not start the allowance clock',
  recipient_join_granted_at IS NOT NULL AND caller_join_granted_at IS NULL AND allowance_started_at IS NULL, ''
FROM public.video_calls WHERE id = public.t72_id('j1');

SELECT public.t72_shift('j1', 25);   -- 25 s pass with only one side in the channel
INSERT INTO public.t_results SELECT 'join grants: ringing/one-sided connecting consumes nothing',
  public.t72_used('72000000-0000-0000-0000-00000000000a') = 0,
  public.t72_used('72000000-0000-0000-0000-00000000000a')::text;

SELECT public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'join grants: both granted starts the clock and bounds the window to 30 s',
  allowance_started_at IS NOT NULL
    AND abs(extract(epoch FROM free_call_until - allowance_started_at) - 30) < 1, extract(epoch FROM free_call_until - allowance_started_at)::text
FROM public.video_calls WHERE id = public.t72_id('j1');

-- Token renewals (repeat calls) never move the clock.
INSERT INTO public.t_json SELECT 'j1_before', to_jsonb(allowance_started_at) FROM public.video_calls WHERE id = public.t72_id('j1');
SELECT public.t72_shift('j1', 5);
SELECT public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-00000000000a');
SELECT public.get_call_join_context(public.t72_id('j1'), '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'join grants: repeated token requests do not restart the clock',
  allowance_started_at = (SELECT (result#>>'{}')::timestamptz FROM public.t_json WHERE label = 'j1_before') - interval '5 seconds', ''
FROM public.video_calls WHERE id = public.t72_id('j1');

-- Modified client never reports "connected", talks 20 s, hangs up: those 20 s now count (were free before).
SELECT public.t72_shift('j1', 15);   -- 20 s since both joined
SELECT public.t72_end('j1', '72000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'bypass closed: unreported-but-joined time is charged to the allowance',
  public.t72_used('72000000-0000-0000-0000-00000000000a') BETWEEN 19 AND 21,
  public.t72_used('72000000-0000-0000-0000-00000000000a')::text;

-- ================= C. Late "connected" report cannot extend free time =================
SELECT public.t72_call('j2', '72aaaaaa-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'boundary: the next call gets exactly the remaining seconds',
  billing_free_seconds BETWEEN 9 AND 11, billing_free_seconds::text
FROM public.video_calls WHERE id = public.t72_id('j2');
SELECT public.get_call_join_context(public.t72_id('j2'), '72000000-0000-0000-0000-00000000000a');
SELECT public.get_call_join_context(public.t72_id('j2'), '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_json SELECT 'j2_until', to_jsonb(free_call_until) FROM public.video_calls WHERE id = public.t72_id('j2');
SELECT public.t72_shift('j2', 6);
SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000a';
SELECT public.mark_call_connected(public.t72_id('j2'));
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'j2_conn', public.mark_call_connected(public.t72_id('j2'));
RESET ROLE;
INSERT INTO public.t_results SELECT 'late connect report: window is not restarted (only what is left is offered)',
  free_call_until = (SELECT (result#>>'{}')::timestamptz FROM public.t_json WHERE label = 'j2_until') - interval '6 seconds'
    AND (SELECT (result->>'seconds_remaining')::int FROM public.t_json WHERE label = 'j2_conn') <= 5,
  (SELECT result::text FROM public.t_json WHERE label = 'j2_conn')
FROM public.video_calls WHERE id = public.t72_id('j2');

-- Run past the window: usage never exceeds the daily 30 s, whatever happens to timers.
SELECT public.t72_shift('j2', 120);
SELECT public.t72_end('j2', '72000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'boundary: total free usage is capped at exactly 30 s',
  public.t72_used('72000000-0000-0000-0000-00000000000a') = 30,
  public.t72_used('72000000-0000-0000-0000-00000000000a')::text;

-- Exhausted + no coins: the accept is refused by the server with a clear reason.
SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'j3', (public.create_video_call('72aaaaaa-0000-0000-0000-0000000000a1', 'video')->>'call_id')::uuid;
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'j3_acc', public.transition_video_call(public.t72_id('j3'), 'accept');
INSERT INTO public.t_json SELECT 'j3_acc2', public.transition_video_call(public.t72_id('j3'), 'accept');
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'al_free_after', public.get_my_video_call_allowance();
SELECT public.transition_video_call(public.t72_id('j3'), 'cancel');
RESET ROLE;
INSERT INTO public.t_results SELECT 'exhausted free caller without coins: accept refused (daily_call_allowance_used)',
  result->>'success' = 'false' AND result->>'error' = 'daily_call_allowance_used', result::text
FROM public.t_json WHERE label = 'j3_acc';
INSERT INTO public.t_results SELECT 'exhausted: a duplicate accept is refused the same way and charges nothing',
  result->>'success' = 'false' AND public.t_balance('72000000-0000-0000-0000-00000000000a') = 0
    AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE call_id = public.t72_id('j3')), result::text
FROM public.t_json WHERE label = 'j3_acc2';
INSERT INTO public.t_results SELECT 'allowance RPC: exhausted after 30 s',
  (result->>'seconds_remaining')::int = 0 AND result->>'status' = 'exhausted', result::text
FROM public.t_json WHERE label = 'al_free_after';
INSERT INTO public.t_results SELECT 'recipient allowance is untouched (the caller pays, unchanged rule)',
  public.t72_used('72000000-0000-0000-0000-00000000000b') = 0, public.t72_used('72000000-0000-0000-0000-00000000000b')::text;

-- ================= D. IST midnight reset =================
-- Move every call of A to just before today's IST midnight: none of it counts today.
UPDATE public.video_calls SET
  accepted_at = ((timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 minute',
  allowance_started_at = ((timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '50 seconds',
  ended_at = ((timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 second'
WHERE caller_id = '72000000-0000-0000-0000-00000000000a' AND accepted_at IS NOT NULL;
INSERT INTO public.t_results SELECT 'IST reset: calls accepted before 00:00 IST do not count today',
  public.t72_used('72000000-0000-0000-0000-00000000000a') = 0, public.t72_used('72000000-0000-0000-0000-00000000000a')::text;
UPDATE public.video_calls SET accepted_at = ((timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
WHERE id = public.t72_id('j1');
INSERT INTO public.t_results SELECT 'IST reset: a call accepted exactly at 00:00 IST counts toward the new day',
  public.t72_used('72000000-0000-0000-0000-00000000000a') > 0, public.t72_used('72000000-0000-0000-0000-00000000000a')::text;

-- ================= E. Premium 300 s =================
SELECT public.t72_call('p1', '72aaaaaa-0000-0000-0000-0000000000a2', '72000000-0000-0000-0000-00000000000c', '72000000-0000-0000-0000-00000000000d');
INSERT INTO public.t_results SELECT 'premium: 300 s window, never charged coins',
  billing_exempt AND billing_free_seconds = 300, billing_free_seconds::text
FROM public.video_calls WHERE id = public.t72_id('p1');
SELECT public.get_call_join_context(public.t72_id('p1'), '72000000-0000-0000-0000-00000000000c');
SELECT public.get_call_join_context(public.t72_id('p1'), '72000000-0000-0000-0000-00000000000d');
SELECT public.t72_shift('p1', 400);
SELECT public.t72_end('p1', '72000000-0000-0000-0000-00000000000c');
INSERT INTO public.t_results SELECT 'premium: usage is capped at exactly 300 s even if the call ran long',
  public.t72_used('72000000-0000-0000-0000-00000000000c') = 300, public.t72_used('72000000-0000-0000-0000-00000000000c')::text;
SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_calls SELECT 'p2', (public.create_video_call('72aaaaaa-0000-0000-0000-0000000000a2', 'video')->>'call_id')::uuid;
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000d';
INSERT INTO public.t_json SELECT 'p2_acc', public.transition_video_call(public.t72_id('p2'), 'accept');
SET request.jwt.claim.sub = '72000000-0000-0000-0000-00000000000c';
SELECT public.transition_video_call(public.t72_id('p2'), 'cancel');
RESET ROLE;
INSERT INTO public.t_results SELECT 'premium exhausted: accept refused with daily_call_allowance_used',
  result->>'success' = 'false' AND result->>'error' = 'daily_call_allowance_used', result::text
FROM public.t_json WHERE label = 'p2_acc';

-- Expired premium is treated as free (30 s, metered).
SELECT public.t72_call('x1', '72aaaaaa-0000-0000-0000-0000000000a3', '72000000-0000-0000-0000-00000000000e', '72000000-0000-0000-0000-00000000000f');
INSERT INTO public.t_results SELECT 'expired subscription: caller gets the free 30 s, not 300 s',
  NOT billing_exempt AND billing_free_seconds = 30, billing_free_seconds::text
FROM public.video_calls WHERE id = public.t72_id('x1');
SELECT public.t72_end('x1', '72000000-0000-0000-0000-00000000000e');

-- ================= F. Premium rewind (undo_swipe_pass) =================
INSERT INTO auth.users(id, email) VALUES
  ('72000000-0000-0000-0000-000000000021', 'rw-free@x'),
  ('72000000-0000-0000-0000-000000000022', 'rw-prem@x'),
  ('72000000-0000-0000-0000-000000000023', 'rw-target@x'),
  ('72000000-0000-0000-0000-000000000024', 'rw-blocked@x'),
  ('72000000-0000-0000-0000-000000000025', 'rw-paused@x'),
  ('72000000-0000-0000-0000-000000000026', 'rw-expired@x');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000021', 'RwFree', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000022', 'RwPrem', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000023', 'RwT', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000024', 'RwB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000025', 'RwP', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('72000000-0000-0000-0000-000000000026', 'RwE', '1995-01-01', 'man', 'woman');
INSERT INTO public.user_subscriptions(user_id, tier, status, starts_at, expires_at) VALUES
  ('72000000-0000-0000-0000-000000000022', 'premium', 'active', now() - interval '1 day', now() + interval '6 days'),
  ('72000000-0000-0000-0000-000000000026', 'premium', 'active', now() - interval '8 days', now() - interval '1 day');
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('72000000-0000-0000-0000-000000000021', '72000000-0000-0000-0000-000000000023', 'pass'),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000023', 'pass'),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000024', 'pass'),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000025', 'pass'),
  ('72000000-0000-0000-0000-000000000026', '72000000-0000-0000-0000-000000000023', 'pass');
INSERT INTO public.blocks(blocker, blocked) VALUES
  ('72000000-0000-0000-0000-000000000024', '72000000-0000-0000-0000-000000000022');
SET request.jwt.claim.role = 'service_role';
UPDATE public.profiles SET status = 'suspended' WHERE id = '72000000-0000-0000-0000-000000000025';
RESET request.jwt.claim.role;

SET ROLE authenticated;
SET request.jwt.claim.sub = '72000000-0000-0000-0000-000000000021';
INSERT INTO public.t_json SELECT 'rw_free', public.undo_swipe_pass('72000000-0000-0000-0000-000000000023');
SET request.jwt.claim.sub = '72000000-0000-0000-0000-000000000026';
INSERT INTO public.t_json SELECT 'rw_expired', public.undo_swipe_pass('72000000-0000-0000-0000-000000000023');
SET request.jwt.claim.sub = '72000000-0000-0000-0000-000000000022';
INSERT INTO public.t_json SELECT 'rw_blocked', public.undo_swipe_pass('72000000-0000-0000-0000-000000000024');
INSERT INTO public.t_json SELECT 'rw_paused', public.undo_swipe_pass('72000000-0000-0000-0000-000000000025');
INSERT INTO public.t_json SELECT 'rw_ok', public.undo_swipe_pass('72000000-0000-0000-0000-000000000023');
INSERT INTO public.t_json SELECT 'rw_again', public.undo_swipe_pass('72000000-0000-0000-0000-000000000023');
CALL public.expect_fail('rewind: cannot target yourself', $q$SELECT public.undo_swipe_pass('72000000-0000-0000-0000-000000000022')$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('rewind: anon cannot call the RPC', $q$SELECT public.undo_swipe_pass('72000000-0000-0000-0000-000000000023')$q$);
RESET ROLE;

INSERT INTO public.t_results SELECT 'rewind: free member is denied by the server and nothing is deleted',
  result->>'error' = 'upgrade_required' AND EXISTS (SELECT 1 FROM public.swipes
    WHERE from_id = '72000000-0000-0000-0000-000000000021' AND to_id = '72000000-0000-0000-0000-000000000023'), result::text
FROM public.t_json WHERE label = 'rw_free';
INSERT INTO public.t_results SELECT 'rewind: expired subscription is denied',
  result->>'error' = 'upgrade_required' AND EXISTS (SELECT 1 FROM public.swipes
    WHERE from_id = '72000000-0000-0000-0000-000000000026' AND to_id = '72000000-0000-0000-0000-000000000023'), result::text
FROM public.t_json WHERE label = 'rw_expired';
INSERT INTO public.t_results SELECT 'rewind: a profile that blocked me is not restored',
  result->>'error' = 'profile_unavailable' AND result->>'undone' = 'false', result::text
FROM public.t_json WHERE label = 'rw_blocked';
INSERT INTO public.t_results SELECT 'rewind: a suspended profile is not restored',
  result->>'error' = 'profile_unavailable', result::text
FROM public.t_json WHERE label = 'rw_paused';
INSERT INTO public.t_results SELECT 'rewind: premium member restores only their own pass',
  (result->>'undone')::boolean
    AND NOT EXISTS (SELECT 1 FROM public.swipes WHERE from_id = '72000000-0000-0000-0000-000000000022'
                    AND to_id = '72000000-0000-0000-0000-000000000023')
    AND EXISTS (SELECT 1 FROM public.swipes WHERE from_id = '72000000-0000-0000-0000-000000000021'
                AND to_id = '72000000-0000-0000-0000-000000000023'), result::text
FROM public.t_json WHERE label = 'rw_ok';
INSERT INTO public.t_results SELECT 'rewind: a repeated (duplicate) undo is a no-op',
  result->>'undone' = 'false', result::text
FROM public.t_json WHERE label = 'rw_again';

-- Deleted account: the profile row is gone, rewind refuses.
DELETE FROM auth.users WHERE id = '72000000-0000-0000-0000-000000000023';
SET ROLE authenticated; SET request.jwt.claim.sub = '72000000-0000-0000-0000-000000000022';
INSERT INTO public.t_json SELECT 'rw_deleted', public.undo_swipe_pass('72000000-0000-0000-0000-000000000023');
RESET ROLE;
INSERT INTO public.t_results SELECT 'rewind: a deleted account cannot be restored',
  result->>'error' = 'profile_unavailable', result::text
FROM public.t_json WHERE label = 'rw_deleted';
