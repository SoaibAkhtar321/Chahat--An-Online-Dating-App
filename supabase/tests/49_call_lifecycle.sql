\set ON_ERROR_STOP on
-- Call lifecycle completion: authoritative expiry, recipient-only signaling, recovery snapshot,
-- invitation abuse limits, ringing push eligibility. Runs inside the functional database.

INSERT INTO auth.users(id, email) VALUES
  ('91000000-0000-0000-0000-000000000001', 'lc-a@x'),
  ('91000000-0000-0000-0000-000000000002', 'lc-b@x'),
  ('91000000-0000-0000-0000-000000000003', 'lc-c@x'),
  ('91000000-0000-0000-0000-000000000004', 'lc-d@x');
INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'photos', id || '/lc.jpg', id::uuid FROM public.profiles
WHERE id LIKE '91000000-%';
UPDATE public.profiles
SET name = 'LC', dob = '1995-01-01', gender = 'man', seeking = 'woman', city = 'Pune',
    bio = 'A complete lifecycle test profile.', intents = ARRAY['Friendship'],
    interests = ARRAY['Books', 'Coffee', 'Music'], languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object('id', 'lc', 'path', id || '/lc.jpg', 'thumbPath', id || '/lc.jpg')),
    onboarded = true
WHERE id LIKE '91000000-%';
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-0000000000e1', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002'),
  ('dddddddd-0000-0000-0000-0000000000e2', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003'),
  ('dddddddd-0000-0000-0000-0000000000e3', '91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000004');
INSERT INTO public.push_devices(user_id, token, platform) VALUES
  ('91000000-0000-0000-0000-000000000002', 'ExponentPushToken[lifecycle-device-b-0001]', 'android');

CREATE TABLE public.lc_calls(label text PRIMARY KEY, id uuid);
GRANT ALL ON public.lc_calls TO PUBLIC;

-- ---- 1. A pending call whose time ran out is closed by the sweeper, once ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.lc_calls SELECT 'p1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'video')->>'call_id')::uuid;
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'signal: recipient receives exactly one incoming event',
  count(*) = 1, count(*)::text FROM public.call_events WHERE call_id = (SELECT id FROM public.lc_calls WHERE label='p1') AND event = 'incoming';
INSERT INTO public.t_results SELECT 'signal: incoming event carries no token or billing data',
  NOT (to_jsonb(e) ?| ARRAY['token', 'billing_rate_coins', 'free_call_until']), 'columns ok'
  FROM public.call_events e WHERE e.call_id = (SELECT id FROM public.lc_calls WHERE label='p1') LIMIT 1;
INSERT INTO public.t_results SELECT 'recovery: recipient snapshot lists the ringing call',
  jsonb_array_length(s->'incoming') = 1 AND (s->'incoming'->0->>'call_id')::uuid = (SELECT id FROM public.lc_calls WHERE label='p1'), s::text
  FROM (SELECT public.get_call_sync() AS s) q;
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'signal: caller gets no incoming event for own call',
  count(*) = 0, count(*)::text FROM public.call_events WHERE event = 'incoming';
INSERT INTO public.t_results SELECT 'recovery: caller snapshot has no incoming entry',
  jsonb_array_length(public.get_call_sync()->'incoming') = 0, 'caller';
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000003';
INSERT INTO public.t_results SELECT 'signal: unrelated user sees no call events',
  count(*) = 0, count(*)::text FROM public.call_events;
INSERT INTO public.t_results SELECT 'recovery: unrelated user snapshot is empty',
  jsonb_array_length(s->'incoming') = 0 AND jsonb_array_length(s->'active') = 0, s::text FROM (SELECT public.get_call_sync() s) q;
RESET ROLE;

UPDATE public.video_calls SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM public.lc_calls WHERE label='p1');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
CREATE TEMP TABLE sweep1 AS SELECT public.expire_video_calls() AS r;
CREATE TEMP TABLE sweep2 AS SELECT public.expire_video_calls() AS r;
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'expiry: sweeper times out an abandoned pending call',
  c.status = 'timed_out' AND c.ended_at IS NOT NULL, c.status FROM public.video_calls c WHERE c.id = (SELECT id FROM public.lc_calls WHERE label='p1');
INSERT INTO public.t_results SELECT 'expiry: first run reports it, duplicate run changes nothing',
  (SELECT (r->>'timed_out')::int FROM sweep1) >= 1 AND (SELECT (r->>'timed_out')::int + (r->>'ended')::int FROM sweep2) = 0,
  (SELECT r::text FROM sweep2);
INSERT INTO public.t_results SELECT 'expiry: duplicate scheduler run emits exactly one timed_out event per participant',
  count(*) = 2, count(*)::text FROM public.call_events WHERE call_id = (SELECT id FROM public.lc_calls WHERE label='p1') AND event = 'timed_out';

SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'recovery: timed-out call is no longer offered as incoming',
  jsonb_array_length(public.get_call_sync()->'incoming') = 0, 'cleared';
CALL public.expect_fail('stale invitation cannot be accepted after expiry',
  $q$SELECT public.transition_video_call((SELECT id FROM public.lc_calls WHERE label='p1'), 'accept')$q$);
RESET ROLE;

-- ---- 2. Sweeps never touch live calls ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.lc_calls SELECT 'a1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
SELECT public.transition_video_call((SELECT id FROM public.lc_calls WHERE label='a1'), 'accept');
INSERT INTO public.t_results SELECT 'recovery: both sides see the accepted call as active',
  jsonb_array_length(public.get_call_sync()->'active') = 1, 'recipient';
RESET ROLE;
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.expire_video_calls();
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'expiry: an in-window accepted call is never expired',
  status = 'accepted', status FROM public.video_calls WHERE id = (SELECT id FROM public.lc_calls WHERE label='a1');

UPDATE public.video_calls SET free_call_until = now() - interval '5 seconds' WHERE id = (SELECT id FROM public.lc_calls WHERE label='a1');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.expire_video_calls();
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'expiry: a metered call past its authorised time is ended and settled',
  status = 'ended' AND settled_at IS NOT NULL AND ended_at <= now(), status || ':' || (settled_at IS NOT NULL)::text
  FROM public.video_calls WHERE id = (SELECT id FROM public.lc_calls WHERE label='a1');

-- unmetered (exempt) calls: capped at the maximum duration, not before
INSERT INTO public.video_calls(match_id, caller_id, recipient_id, call_type, status, expires_at, accepted_at, billing_exempt, free_call_until)
VALUES ('dddddddd-0000-0000-0000-0000000000e2', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003',
        'video', 'accepted', now() + interval '1 hour', now() - interval '1 hour', true, NULL);
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.expire_video_calls();
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'expiry: unmetered call inside the maximum duration keeps running',
  count(*) = 1, count(*)::text FROM public.video_calls WHERE match_id = 'dddddddd-0000-0000-0000-0000000000e2' AND status = 'accepted';
UPDATE public.video_calls SET accepted_at = now() - interval '4 hours' WHERE match_id = 'dddddddd-0000-0000-0000-0000000000e2' AND status = 'accepted';
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.expire_video_calls();
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'expiry: abandoned unmetered call is ended at the cap and settled',
  status = 'ended' AND settled_at IS NOT NULL AND duration_seconds = 10800, status || ':' || coalesce(duration_seconds::text, 'null')
  FROM public.video_calls WHERE match_id = 'dddddddd-0000-0000-0000-0000000000e2' AND status = 'ended';

-- ---- 3. Stale rows cannot block a new invitation or count as an active call ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.lc_calls SELECT 'p2', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'video')->>'call_id')::uuid;
RESET ROLE;
UPDATE public.video_calls SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM public.lc_calls WHERE label='p2');
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
CALL public.expect_ok('stale pending row does not block the next invitation for the same match',
  $q$SELECT public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'video')$q$);
INSERT INTO public.t_results SELECT 'expiry: the stale row was closed, not left pending',
  status = 'timed_out', status FROM public.video_calls WHERE id = (SELECT id FROM public.lc_calls WHERE label='p2');
RESET ROLE;
UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE caller_id = '91000000-0000-0000-0000-000000000001' AND status = 'pending';

-- ---- 4. Unauthorised access ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
CALL public.expect_fail('clients cannot run the sweeper', $q$SELECT public.expire_video_calls()$q$);
CALL public.expect_fail('clients cannot forge signaling events',
  $q$INSERT INTO public.call_events(call_id, user_id, event, call_type, match_id, caller_id, expires_at)
     SELECT id, '91000000-0000-0000-0000-000000000002', 'incoming', 'video', match_id, caller_id, now() FROM public.video_calls LIMIT 1$q$);
CALL public.expect_fail('clients cannot edit signaling events', $q$UPDATE public.call_events SET event = 'ended'$q$);
CALL public.expect_fail('clients cannot delete signaling events', $q$DELETE FROM public.call_events$q$);
CALL public.expect_fail('clients cannot call the block helper', $q$SELECT public._pair_blocked('a', 'b')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '';
CALL public.expect_fail('recovery snapshot needs authentication', $q$SELECT public.get_call_sync()$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('anon cannot read signaling events', $q$SELECT * FROM public.call_events$q$);
CALL public.expect_fail('anon cannot request a recovery snapshot', $q$SELECT public.get_call_sync()$q$);
RESET ROLE;

-- ---- 5. Blocking removes a ringing call from recovery ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000004';
INSERT INTO public.lc_calls SELECT 'b1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e3', 'audio')->>'call_id')::uuid;
RESET ROLE;
INSERT INTO public.blocks(blocker, blocked) VALUES ('91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000004');
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'recovery: a call from a blocked user is not offered',
  jsonb_array_length(public.get_call_sync()->'incoming') = 0, 'blocked';
RESET ROLE;

-- ---- 6. Ringing push: only for a live, unblocked, pending call ----
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results SELECT 'push: call to a user who blocked the caller gets no delivery',
  count(*) = 0, count(*)::text
  FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.category = 'call' AND o.event_id = (SELECT id::text FROM public.lc_calls WHERE label='b1');
RESET ROLE; RESET request.jwt.claim.role;
DELETE FROM public.blocks WHERE blocker = '91000000-0000-0000-0000-000000000002';
UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = (SELECT id FROM public.lc_calls WHERE label='b1');

-- age the earlier attempts out of the 10-minute abuse window
UPDATE public.video_calls SET created_at = now() - interval '1 hour' WHERE match_id = 'dddddddd-0000-0000-0000-0000000000e1';
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.lc_calls SELECT 'r1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'video')->>'call_id')::uuid;
RESET ROLE;
INSERT INTO public.t_results SELECT 'push: ringing notification route data carries only ids and call type',
  o.route_data ?& ARRAY['callId', 'matchId', 'callType'] AND (SELECT count(*) FROM jsonb_object_keys(o.route_data)) = 3, o.route_data::text
  FROM public.notification_outbox o WHERE o.category = 'call' AND o.event_id = (SELECT id::text FROM public.lc_calls WHERE label='r1');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results SELECT 'push: a live ringing call produces one delivery',
  count(*) = 1, count(*)::text
  FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.event_id = (SELECT id::text FROM public.lc_calls WHERE label='r1');
RESET ROLE; RESET request.jwt.claim.role;
UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = (SELECT id FROM public.lc_calls WHERE label='r1');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT count(*) FROM public.claim_push_deliveries(10);
INSERT INTO public.t_results SELECT 'push: a delivery for a call cancelled before dispatch is suppressed',
  d.status = 'suppressed' AND d.last_error = 'CallNoLongerRinging', d.status || ':' || coalesce(d.last_error, '')
  FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.event_id = (SELECT id::text FROM public.lc_calls WHERE label='r1');
RESET ROLE; RESET request.jwt.claim.role;

-- call to a recipient who turned call alerts off: no delivery
INSERT INTO public.notification_preferences(user_id, calls) VALUES ('91000000-0000-0000-0000-000000000002', false)
ON CONFLICT (user_id) DO UPDATE SET calls = false;
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
INSERT INTO public.lc_calls SELECT 'r2', (public.create_video_call('dddddddd-0000-0000-0000-0000000000e1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results SELECT 'push: call alerts switched off are respected',
  count(*) = 0, count(*)::text
  FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.event_id = (SELECT id::text FROM public.lc_calls WHERE label='r2');
RESET ROLE; RESET request.jwt.claim.role;
UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = (SELECT id FROM public.lc_calls WHERE label='r2');
DELETE FROM public.notification_preferences WHERE user_id = '91000000-0000-0000-0000-000000000002';

-- ---- 7. Unanswered-invitation limits (3 per match / 10 min) ----
SET ROLE authenticated; SET request.jwt.claim.sub = '91000000-0000-0000-0000-000000000001';
DO $$
DECLARE _i int;
BEGIN
  FOR _i IN 1..3 LOOP
    PERFORM public.create_video_call('dddddddd-0000-0000-0000-0000000000e2', 'audio');
    PERFORM public.transition_video_call((SELECT id FROM public.video_calls WHERE caller_id = auth.uid() AND status = 'pending' AND match_id = 'dddddddd-0000-0000-0000-0000000000e2'), 'cancel');
  END LOOP;
END $$;
CALL public.expect_fail('a fourth unanswered invitation to one match within 10 minutes is refused',
  $q$SELECT public.create_video_call('dddddddd-0000-0000-0000-0000000000e2', 'audio')$q$);
RESET ROLE;
