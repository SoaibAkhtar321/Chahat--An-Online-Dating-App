\set ON_ERROR_STOP on
-- 20260101006400: an unanswered call (cancelled by the caller or rung out) queues one 'missed_call' push for the
-- callee; answered/declined calls do not; the "Calls" preference and blocks are honoured.
INSERT INTO auth.users(id, email) VALUES
  ('79000000-0000-0000-0000-00000000000a', 'mc-a@x'), ('79000000-0000-0000-0000-00000000000b', 'mc-b@x');
CALL public.test_complete_profile('79000000-0000-0000-0000-00000000000a', 'McA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('79000000-0000-0000-0000-00000000000b', 'McB', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('79aaaaaa-0000-0000-0000-000000000001', '79000000-0000-0000-0000-00000000000a', '79000000-0000-0000-0000-00000000000b');
INSERT INTO public.app_settings (key, value) VALUES
  ('call_create_limit_per_10min', '1000'::jsonb), ('call_create_limit_per_match_10min', '1000'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE FUNCTION public.t79_call(_label text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  UPDATE public.video_calls SET status = 'ended', ended_at = now()
  WHERE status IN ('pending', 'accepted') AND '79000000-0000-0000-0000-00000000000a' IN (caller_id, recipient_id);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '79000000-0000-0000-0000-00000000000a', true);
  _id := (public.create_video_call('79aaaaaa-0000-0000-0000-000000000001', 'video')->>'call_id')::uuid;
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.t_calls VALUES (_label, _id);
  RETURN _id;
END $$;
CREATE FUNCTION public.t79_as(_uid text, _call uuid, _action text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _uid, true);
  PERFORM public.transition_video_call(_call, _action);
  PERFORM set_config('role', 'postgres', true);
END $$;
CREATE FUNCTION public.t79_missed(_call uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.notification_outbox WHERE category = 'missed_call' AND event_id = _call::text;
$$;

-- 1. Caller cancels while ringing -> one missed-call push for the callee.
SELECT public.t79_call('mc_cancel');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000a', public.t72_id('mc_cancel'), 'cancel');
INSERT INTO public.t_results SELECT 'missed call: caller cancels -> one push for the callee only',
  public.t79_missed(public.t72_id('mc_cancel')) = 1
    AND (SELECT recipient_id::text FROM public.notification_outbox WHERE category = 'missed_call'
         AND event_id = public.t72_id('mc_cancel')::text) = '79000000-0000-0000-0000-00000000000b'
    AND (SELECT route_data->>'matchId' FROM public.notification_outbox WHERE category = 'missed_call'
         AND event_id = public.t72_id('mc_cancel')::text) = '79aaaaaa-0000-0000-0000-000000000001', '';

-- 2. Rings out (timed out by the sweeper) -> push.
SELECT public.t79_call('mc_timeout');
UPDATE public.video_calls SET expires_at = now() - interval '1 second' WHERE id = public.t72_id('mc_timeout');
SELECT public.expire_video_calls(100);
INSERT INTO public.t_results SELECT 'missed call: unanswered call that rings out -> push',
  public.t79_missed(public.t72_id('mc_timeout')) = 1, (SELECT status FROM public.video_calls WHERE id = public.t72_id('mc_timeout'));

-- 3. Declined or answered -> no missed-call push.
SELECT public.t79_call('mc_declined');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000b', public.t72_id('mc_declined'), 'decline');
SELECT public.t79_call('mc_answered');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000b', public.t72_id('mc_answered'), 'accept');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000a', public.t72_id('mc_answered'), 'end');
INSERT INTO public.t_results SELECT 'missed call: declined or answered calls send no missed-call push',
  public.t79_missed(public.t72_id('mc_declined')) = 0 AND public.t79_missed(public.t72_id('mc_answered')) = 0, '';

-- 4. Duplicate transitions never queue a second push.
SELECT public.t79_as('79000000-0000-0000-0000-00000000000a', public.t72_id('mc_cancel'), 'cancel');
INSERT INTO public.t_results SELECT 'missed call: a replayed cancel does not queue a second push',
  public.t79_missed(public.t72_id('mc_cancel')) = 1, '';

-- 5. Delivery honours the Calls preference (materialize -> no delivery rows when calls are off).
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
VALUES ('79000000-0000-0000-0000-00000000000b', 'push_notifications', '2026-10-18', 'granted', 'in_app_notice');
INSERT INTO public.push_devices(user_id, token, platform)
VALUES ('79000000-0000-0000-0000-00000000000b', 'ExponentPushToken[mccalleedevice000001]', 'android');
INSERT INTO public.notification_preferences(user_id, calls) VALUES ('79000000-0000-0000-0000-00000000000b', false)
ON CONFLICT (user_id) DO UPDATE SET calls = false;
SELECT public.t79_call('mc_pref_off');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000a', public.t72_id('mc_pref_off'), 'cancel');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'missed call: no delivery when the callee turned call notifications off',
  NOT EXISTS (SELECT 1 FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
              WHERE o.category = 'missed_call' AND o.event_id = public.t72_id('mc_pref_off')::text), '';
UPDATE public.notification_preferences SET calls = true WHERE user_id = '79000000-0000-0000-0000-00000000000b';
SELECT public.t79_call('mc_pref_on');
SELECT public.t79_as('79000000-0000-0000-0000-00000000000a', public.t72_id('mc_pref_on'), 'cancel');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_json SELECT 'mc_claim', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_push_deliveries(100) c
WHERE c.category = 'missed_call';
RESET ROLE; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'missed call: with call notifications on, the push is delivered (claimed for sending)',
  EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT result FROM public.t_json WHERE label = 'mc_claim')) e
          WHERE e->'route_data'->>'callId' = public.t72_id('mc_pref_on')::text), (SELECT result::text FROM public.t_json WHERE label = 'mc_claim');
