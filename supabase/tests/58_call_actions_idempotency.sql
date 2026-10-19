\set ON_ERROR_STOP on
-- Chahat Phase 3: Answer / Decline / Cancel / End are authoritative, recipient-only where relevant,
-- idempotent on replay, and replays never emit a second signaling event or a second charge.
-- Users: A caller, B recipient, X stranger. B has a push device (consent granted).
INSERT INTO auth.users(id, email) VALUES
  ('58000000-0000-0000-0000-00000000000a', 'p3-a@x'),
  ('58000000-0000-0000-0000-00000000000b', 'p3-b@x'),
  ('58000000-0000-0000-0000-00000000000c', 'p3-x@x');
CALL public.test_complete_profile('58000000-0000-0000-0000-00000000000a', 'Caller A', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('58000000-0000-0000-0000-00000000000b', 'Recipient B', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('58000000-0000-0000-0000-00000000000c', 'Stranger X', '1995-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-0000000000f1', '58000000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-00000000000b');
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method) VALUES
  ('58000000-0000-0000-0000-00000000000b', 'push_notifications', '2026-10-18', 'granted', 'in_app_notice');
INSERT INTO public.push_devices(user_id, token, platform) VALUES
  ('58000000-0000-0000-0000-00000000000b', 'ExponentPushToken[phase3-device-b-000001]', 'android');
-- Legacy per-call billing rules keep this suite independent of the daily allowance state.
INSERT INTO public.app_settings (key, value) VALUES ('call_daily_allowance_enabled', '0'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE TABLE public.p3_calls(label text PRIMARY KEY, id uuid);
GRANT ALL ON public.p3_calls TO PUBLIC;
CREATE TABLE public.p3_snap(label text PRIMARY KEY, v jsonb);
GRANT ALL ON public.p3_snap TO PUBLIC;

-- ---- 1. Decline: recipient only, atomic, idempotent ----
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
INSERT INTO public.p3_calls SELECT 'd1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000f1', 'video')->>'call_id')::uuid;
CALL public.expect_fail('decline: the caller cannot decline their own invitation',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'decline')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000c';
CALL public.expect_fail('decline: a stranger cannot decline someone else''s call',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'decline')$q$);
CALL public.expect_fail('accept: a stranger cannot answer someone else''s call',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'accept')$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'decline: failed attempts by caller/stranger left the call pending',
  status = 'pending', status FROM public.video_calls WHERE id = (SELECT id FROM public.p3_calls WHERE label='d1');

SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
INSERT INTO public.p3_snap SELECT 'd1_first', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'decline');
INSERT INTO public.p3_snap SELECT 'd1_replay', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'decline');
INSERT INTO public.p3_snap SELECT 'd1_replay2', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'decline');
RESET ROLE;
INSERT INTO public.t_results SELECT 'decline: first decline succeeds',
  (v->>'success')::boolean AND v->>'status' = 'declined' AND NOT (v ? 'replayed'), v::text FROM public.p3_snap WHERE label = 'd1_first';
INSERT INTO public.t_results SELECT 'decline: repeated decline is a safe success (idempotent)',
  (a.v->>'success')::boolean AND a.v->>'status' = 'declined' AND (b.v->>'success')::boolean AND (a.v->>'replayed')::boolean,
  a.v::text FROM public.p3_snap a, public.p3_snap b WHERE a.label = 'd1_replay' AND b.label = 'd1_replay2';
INSERT INTO public.t_results SELECT 'decline: replays emit no extra signaling (exactly one declined event per participant)',
  count(*) = 2, count(*)::text FROM public.call_events
  WHERE call_id = (SELECT id FROM public.p3_calls WHERE label='d1') AND event = 'declined';
INSERT INTO public.t_results SELECT 'decline: ended_at is set once and status is declined',
  status = 'declined' AND ended_at IS NOT NULL, status FROM public.video_calls WHERE id = (SELECT id FROM public.p3_calls WHERE label='d1');

SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
CALL public.expect_fail('accept: a declined call can never be answered afterwards',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'accept')$q$);
INSERT INTO public.t_results SELECT 'recovery: declined call is not offered as incoming',
  jsonb_array_length(public.get_call_sync()->'incoming') = 0, 'cleared';
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('cancel: caller cannot cancel a call the recipient already declined',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='d1'), 'cancel')$q$);
RESET ROLE;

-- ---- 2. Answer: atomic, recipient only, idempotent, no second charge/session ----
UPDATE public.video_calls SET created_at = now() - interval '1 hour' WHERE match_id = 'dddddddd-0000-0000-0000-0000000000f1';
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
INSERT INTO public.p3_calls SELECT 'a1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000f1', 'video')->>'call_id')::uuid;
CALL public.expect_fail('accept: the caller cannot answer their own call',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'accept')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
INSERT INTO public.p3_snap SELECT 'a1_first', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'accept');
RESET ROLE;
INSERT INTO public.p3_snap SELECT 'a1_row', to_jsonb(c) FROM public.video_calls c WHERE c.id = (SELECT id FROM public.p3_calls WHERE label='a1');
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
INSERT INTO public.p3_snap SELECT 'a1_replay', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'accept');
CALL public.expect_fail('decline: an answered call cannot be declined afterwards (answer and decline race resolves to one outcome)',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'decline')$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'accept: first answer succeeds', (v->>'success')::boolean AND v->>'status' = 'accepted', v::text
  FROM public.p3_snap WHERE label = 'a1_first';
INSERT INTO public.t_results SELECT 'accept: repeated answer is a safe success and does not restart or recharge the call',
  (r.v->>'success')::boolean AND (r.v->>'replayed')::boolean
  AND c.accepted_at = (s.v->>'accepted_at')::timestamptz
  AND c.free_call_until IS NOT DISTINCT FROM (s.v->>'free_call_until')::timestamptz
  AND c.billed_minutes IS NOT DISTINCT FROM (s.v->>'billed_minutes')::integer
  AND c.coins_charged IS NOT DISTINCT FROM (s.v->>'coins_charged')::integer,
  r.v::text
  FROM public.p3_snap r, public.p3_snap s, public.video_calls c
  WHERE r.label = 'a1_replay' AND s.label = 'a1_row' AND c.id = (SELECT id FROM public.p3_calls WHERE label='a1');
INSERT INTO public.t_results SELECT 'accept: exactly one accepted event per participant despite the replay',
  count(*) = 2, count(*)::text FROM public.call_events
  WHERE call_id = (SELECT id FROM public.p3_calls WHERE label='a1') AND event = 'accepted';
INSERT INTO public.t_results SELECT 'accept: only one accepted call exists for the match (no duplicate session)',
  count(*) = 1, count(*)::text FROM public.video_calls WHERE match_id = 'dddddddd-0000-0000-0000-0000000000f1' AND status = 'accepted';

-- ---- 3. End / Cancel replays ----
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
INSERT INTO public.p3_snap SELECT 'e1_first', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'end');
INSERT INTO public.p3_snap SELECT 'e1_replay', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='a1'), 'end');
RESET ROLE;
INSERT INTO public.t_results SELECT 'end: first end succeeds and repeated end is a safe success',
  (a.v->>'status') = 'ended' AND (b.v->>'status') = 'ended' AND (b.v->>'success')::boolean AND (b.v->>'replayed')::boolean, b.v::text
  FROM public.p3_snap a, public.p3_snap b WHERE a.label = 'e1_first' AND b.label = 'e1_replay';
INSERT INTO public.t_results SELECT 'end: replay emits no extra ended event (one per participant)',
  count(*) = 2, count(*)::text FROM public.call_events WHERE call_id = (SELECT id FROM public.p3_calls WHERE label='a1') AND event = 'ended';

UPDATE public.video_calls SET created_at = now() - interval '1 hour' WHERE match_id = 'dddddddd-0000-0000-0000-0000000000f1';
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
INSERT INTO public.p3_calls SELECT 'c1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000f1', 'video')->>'call_id')::uuid;
INSERT INTO public.p3_snap SELECT 'c1_first', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='c1'), 'cancel');
INSERT INTO public.p3_snap SELECT 'c1_replay', public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='c1'), 'cancel');
RESET ROLE;
INSERT INTO public.t_results SELECT 'cancel: caller cancel then repeated cancel are safe successes',
  (a.v->>'status') = 'cancelled' AND (b.v->>'status') = 'cancelled' AND (b.v->>'replayed')::boolean, b.v::text
  FROM public.p3_snap a, public.p3_snap b WHERE a.label = 'c1_first' AND b.label = 'c1_replay';
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
CALL public.expect_fail('cancel: the recipient cannot cancel (or replay a cancel for) the caller''s call',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='c1'), 'cancel')$q$);
CALL public.expect_fail('accept: a cancelled call can no longer be answered',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='c1'), 'accept')$q$);
CALL public.expect_fail('decline: a cancelled call cannot be declined (the caller cancelled first)',
  $q$SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='c1'), 'decline')$q$);
RESET ROLE;

-- ---- 4. Push: a ringing push is only delivered while the call is pending ----
UPDATE public.video_calls SET created_at = now() - interval '1 hour' WHERE match_id = 'dddddddd-0000-0000-0000-0000000000f1';
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000a';
INSERT INTO public.p3_calls SELECT 'r1', (public.create_video_call('dddddddd-0000-0000-0000-0000000000f1', 'video')->>'call_id')::uuid;
RESET ROLE;
INSERT INTO public.t_results SELECT 'push: one ringing outbox event per call, addressed to the recipient only',
  count(*) = 1 AND bool_and(recipient_id = '58000000-0000-0000-0000-00000000000b'::uuid), count(*)::text
  FROM public.notification_outbox WHERE category = 'call' AND event_id = (SELECT id::text FROM public.p3_calls WHERE label='r1');
INSERT INTO public.t_results SELECT 'push: ringing route data holds only call id, match id and call type',
  route_data ?& ARRAY['callId', 'matchId', 'callType'] AND (SELECT count(*) FROM jsonb_object_keys(route_data)) = 3, route_data::text
  FROM public.notification_outbox WHERE category = 'call' AND event_id = (SELECT id::text FROM public.p3_calls WHERE label='r1');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results SELECT 'push: materializing twice still yields exactly one delivery (no duplicate ringing)',
  count(*) = 1, count(*)::text FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.event_id = (SELECT id::text FROM public.p3_calls WHERE label='r1');
RESET ROLE; RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.p3_calls WHERE label='r1'), 'decline');
RESET ROLE;
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT count(*) FROM public.claim_push_deliveries(10);
INSERT INTO public.t_results SELECT 'push: a delivery for a call declined before dispatch is suppressed, never sent',
  d.status = 'suppressed' AND d.last_error = 'CallNoLongerRinging', d.status || ':' || coalesce(d.last_error, '')
  FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
  WHERE o.event_id = (SELECT id::text FROM public.p3_calls WHERE label='r1');
RESET ROLE; RESET request.jwt.claim.role;

-- ---- 5. Recipient privacy: a signed-in stranger learns nothing about the call ----
SET ROLE authenticated; SET request.jwt.claim.sub = '58000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'privacy: stranger sees no call events and an empty recovery snapshot',
  (SELECT count(*) FROM public.call_events) = 0
  AND jsonb_array_length(public.get_call_sync()->'incoming') = 0 AND jsonb_array_length(public.get_call_sync()->'active') = 0, 'stranger';
RESET ROLE;
