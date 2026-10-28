\set ON_ERROR_STOP on
-- 20260101006000: Agora channel events can only REDUCE a call's allowance charge to the proven overlap, only with
-- complete evidence, and only when call_agora_reconcile_enabled = 1. Reuses helpers from 72 (t72_call, t72_end,
-- t72_id, t72_used) and 10 (t_results, expect_fail, test_complete_profile).
INSERT INTO public.app_settings (key, value) VALUES
  ('call_daily_allowance_enabled', '1'::jsonb), ('call_free_daily_seconds', '30'::jsonb),
  ('call_connect_grace_seconds', '30'::jsonb), ('call_join_slack_seconds', '0'::jsonb),
  ('call_agora_reconcile_enabled', '0'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- One fresh free caller + recipient + match per scenario: 74000000-0000-0000-0000-0000000000<n>a / <n>b.
CREATE FUNCTION public.t74_uid(_n int, _side text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('74000000-0000-0000-0000-0000000000' || lpad(_n::text, 1, '0') || _side)::uuid;
$$;
CREATE FUNCTION public.t74_match(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('74aaaaaa-0000-0000-0000-00000000000' || _n::text)::uuid;
$$;
DO $$
BEGIN
  FOR n IN 1..9 LOOP
    INSERT INTO auth.users(id, email) VALUES
      (public.t74_uid(n, 'a'), 'ncs' || n || 'a@x'), (public.t74_uid(n, 'b'), 'ncs' || n || 'b@x');
    CALL public.test_complete_profile(public.t74_uid(n, 'a'), 'Ncs' || n || 'A', '1995-01-01', 'man', 'woman');
    CALL public.test_complete_profile(public.t74_uid(n, 'b'), 'Ncs' || n || 'B', '1996-01-01', 'woman', 'man');
    INSERT INTO public.matches(id, user_a, user_b) VALUES (public.t74_match(n), public.t74_uid(n, 'a'), public.t74_uid(n, 'b'));
  END LOOP;
END $$;

-- Accept, both join grants, then pretend _secs passed since both were granted, then end.
CREATE FUNCTION public.t74_run_call(_n int, _secs int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  PERFORM public.t72_call('ncs' || _n, public.t74_match(_n), public.t74_uid(_n, 'a'), public.t74_uid(_n, 'b'));
  _id := public.t72_id('ncs' || _n);
  PERFORM public.get_call_join_context(_id, public.t74_uid(_n, 'a'));
  PERFORM public.get_call_join_context(_id, public.t74_uid(_n, 'b'));
  PERFORM public.t72_shift('ncs' || _n, _secs);
  PERFORM public.t72_end('ncs' || _n, public.t74_uid(_n, 'a'));
  RETURN _id;
END $$;
-- Record an event _ago seconds before now for participant side 'a'/'b' of scenario _n.
CREATE FUNCTION public.t74_ev(_notice text, _n int, _side text, _type int, _seq bigint, _ago int) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.record_agora_channel_event(_notice, _type, 'call_' || public.t72_id('ncs' || _n)::text,
    public.t74_uid(_n, _side)::text, _seq, extract(epoch FROM now() - make_interval(secs => _ago))::bigint);
$$;

-- ===== Access =====
SET ROLE authenticated; SET request.jwt.claim.sub = '74000000-0000-0000-0000-00000000001a';
CALL public.expect_fail('ncs: members cannot record channel events',
  $q$SELECT public.record_agora_channel_event('x', 107, 'call_00000000-0000-0000-0000-000000000000', '74000000-0000-0000-0000-00000000001a', 1, 1793160000)$q$);
CALL public.expect_fail('ncs: members cannot read channel events', $q$SELECT * FROM public.call_media_events$q$);
CALL public.expect_fail('ncs: members cannot call the overlap function', $q$SELECT public.call_media_overlap_seconds(gen_random_uuid())$q$);
RESET ROLE;

-- ===== S1: failed connection (only A ever joined), reconcile OFF → token-based charge stays =====
SELECT public.t74_run_call(1, 20);
SELECT public.t74_ev('s1-j', 1, 'a', 107, 1, 19);
SELECT public.t74_ev('s1-l', 1, 'a', 108, 2, 2);
INSERT INTO public.t_results SELECT 'ncs: with reconciliation OFF, events change nothing (token-based 20 s)',
  public.t72_used(public.t74_uid(1, 'a')) BETWEEN 19 AND 21, public.t72_used(public.t74_uid(1, 'a'))::text;

UPDATE public.app_settings SET value = '1'::jsonb WHERE key = 'call_agora_reconcile_enabled';

-- ===== S1 again with reconciliation ON: the other side never joined → nothing charged =====
INSERT INTO public.t_results SELECT 'ncs: failed connection (only one side in the channel) is not charged',
  public.t72_used(public.t74_uid(1, 'a')) = 0, public.t72_used(public.t74_uid(1, 'a'))::text;

-- ===== S2: both in the channel 12 s of the 20 s token window → 12 s =====
SELECT public.t74_run_call(2, 20);
SELECT public.t74_ev('s2-aj', 2, 'a', 107, 1, 18);
SELECT public.t74_ev('s2-bj', 2, 'b', 107, 1, 15);
SELECT public.t74_ev('s2-bl', 2, 'b', 108, 2, 3);
SELECT public.t74_ev('s2-al', 2, 'a', 108, 2, 2);
INSERT INTO public.t_results SELECT 'ncs: connected call is charged the real overlap (12 s)',
  public.t72_used(public.t74_uid(2, 'a')) = 12, public.t72_used(public.t74_uid(2, 'a'))::text;

-- ===== S3: events claim a longer overlap than the token window → never more than token-based =====
SELECT public.t74_run_call(3, 10);
SELECT public.t74_ev('s3-aj', 3, 'a', 107, 1, 600);
SELECT public.t74_ev('s3-bj', 3, 'b', 107, 1, 600);
SELECT public.t74_ev('s3-al', 3, 'a', 108, 2, 1);
SELECT public.t74_ev('s3-bl', 3, 'b', 108, 2, 1);
INSERT INTO public.t_results SELECT 'ncs: events can never raise the charge above the token-based seconds',
  public.t72_used(public.t74_uid(3, 'a')) BETWEEN 9 AND 11, public.t72_used(public.t74_uid(3, 'a'))::text;

-- ===== S4: missing leave (lost / not yet delivered) → incomplete → token-based =====
SELECT public.t74_run_call(4, 20);
SELECT public.t74_ev('s4-aj', 4, 'a', 107, 1, 19);
SELECT public.t74_ev('s4-bj', 4, 'b', 107, 1, 19);
SELECT public.t74_ev('s4-al', 4, 'a', 108, 2, 15);
INSERT INTO public.t_results SELECT 'ncs: a missing leave event keeps the full token-based charge',
  public.call_media_overlap_seconds(public.t72_id('ncs4')) IS NULL
    AND public.t72_used(public.t74_uid(4, 'a')) BETWEEN 19 AND 21, public.t72_used(public.t74_uid(4, 'a'))::text;
-- The late leave arrives: evidence completes and the charge drops to the overlap (4 s).
SELECT public.t74_ev('s4-bl', 4, 'b', 108, 2, 10);
INSERT INTO public.t_results SELECT 'ncs: a delayed event completes the evidence later (charge 4 s)',
  public.t72_used(public.t74_uid(4, 'a')) = 4, public.t72_used(public.t74_uid(4, 'a'))::text;

-- ===== S5: missing join (leave arrives without its join) → incomplete =====
SELECT public.t74_run_call(5, 20);
SELECT public.t74_ev('s5-al', 5, 'a', 108, 2, 2);
INSERT INTO public.t_results SELECT 'ncs: a leave without its join is incomplete evidence (token-based)',
  public.t72_used(public.t74_uid(5, 'a')) BETWEEN 19 AND 21, public.t72_used(public.t74_uid(5, 'a'))::text;

-- ===== S6: duplicates and out-of-order delivery =====
SELECT public.t74_run_call(6, 20);
SELECT public.t74_ev('s6-al', 6, 'a', 108, 2, 2);     -- leave delivered before its join
SELECT public.t74_ev('s6-bl', 6, 'b', 108, 2, 2);
SELECT public.t74_ev('s6-aj', 6, 'a', 107, 1, 10);
SELECT public.t74_ev('s6-bj', 6, 'b', 107, 1, 10);
INSERT INTO public.t_json SELECT 's6_dup', public.t74_ev('s6-aj', 6, 'a', 107, 1, 10);
INSERT INTO public.t_json SELECT 's6_dup_forged', public.t74_ev('s6-aj', 6, 'a', 107, 1, 500);   -- same noticeId, other data
INSERT INTO public.t_results SELECT 'ncs: duplicate deliveries are stored once (noticeId)',
  (SELECT result->>'status' FROM public.t_json WHERE label = 's6_dup') = 'duplicate'
    AND (SELECT result->>'status' FROM public.t_json WHERE label = 's6_dup_forged') = 'duplicate'
    AND (SELECT count(*) FROM public.call_media_events WHERE call_id = public.t72_id('ncs6')) = 4, '';
INSERT INTO public.t_results SELECT 'ncs: out-of-order delivery is ordered by clientSeq (charge 8 s)',
  public.t72_used(public.t74_uid(6, 'a')) = 8, public.t72_used(public.t74_uid(6, 'a'))::text;

-- ===== S7: reconnect — A drops and rejoins; overlap is the sum of shared intervals =====
SELECT public.t74_run_call(7, 30);
SELECT public.t74_ev('s7-aj1', 7, 'a', 107, 1, 28);
SELECT public.t74_ev('s7-bj', 7, 'b', 107, 1, 28);
SELECT public.t74_ev('s7-al1', 7, 'a', 108, 2, 23);   -- 5 s together
SELECT public.t74_ev('s7-aj2', 7, 'a', 107, 3, 13);
SELECT public.t74_ev('s7-al2', 7, 'a', 108, 4, 6);    -- 7 s together
SELECT public.t74_ev('s7-bl', 7, 'b', 108, 2, 5);
INSERT INTO public.t_results SELECT 'ncs: reconnects are summed (5 s + 7 s = 12 s)',
  public.t72_used(public.t74_uid(7, 'a')) = 12, public.t72_used(public.t74_uid(7, 'a'))::text;

-- ===== S8: call still running → token-based, whatever the events say =====
SELECT public.t72_call('ncs8', public.t74_match(8), public.t74_uid(8, 'a'), public.t74_uid(8, 'b'));
SELECT public.get_call_join_context(public.t72_id('ncs8'), public.t74_uid(8, 'a'));
SELECT public.get_call_join_context(public.t72_id('ncs8'), public.t74_uid(8, 'b'));
SELECT public.t72_shift('ncs8', 10);
SELECT public.t74_ev('s8-aj', 8, 'a', 107, 1, 9);
SELECT public.t74_ev('s8-al', 8, 'a', 108, 2, 8);
INSERT INTO public.t_results SELECT 'ncs: an active call is never reduced by events',
  public.call_media_overlap_seconds(public.t72_id('ncs8')) IS NULL
    AND public.t72_used(public.t74_uid(8, 'a')) BETWEEN 9 AND 11, public.t72_used(public.t74_uid(8, 'a'))::text;
SELECT public.t72_end('ncs8', public.t74_uid(8, 'a'));

-- ===== S9: junk is ignored =====
SELECT public.t74_run_call(9, 20);
INSERT INTO public.t_json SELECT 's9_stranger', public.record_agora_channel_event('s9-x', 107,
  'call_' || public.t72_id('ncs9')::text, public.t74_uid(1, 'a')::text, 1, extract(epoch FROM now())::bigint);
INSERT INTO public.t_json SELECT 's9_channel', public.record_agora_channel_event('s9-y', 107,
  'lobby', public.t74_uid(9, 'a')::text, 1, extract(epoch FROM now())::bigint);
INSERT INTO public.t_json SELECT 's9_type', public.record_agora_channel_event('s9-z', 101,
  'call_' || public.t72_id('ncs9')::text, public.t74_uid(9, 'a')::text, 1, extract(epoch FROM now())::bigint);
INSERT INTO public.t_json SELECT 's9_ts', public.record_agora_channel_event('s9-w', 107,
  'call_' || public.t72_id('ncs9')::text, public.t74_uid(9, 'a')::text, 1, 1000);
INSERT INTO public.t_results SELECT 'ncs: non-participant, foreign channel, other event types and bad timestamps are ignored',
  (SELECT bool_and(result->>'status' = 'ignored') FROM public.t_json WHERE label LIKE 's9_%')
    AND NOT EXISTS (SELECT 1 FROM public.call_media_events WHERE call_id = public.t72_id('ncs9'))
    AND public.t72_used(public.t74_uid(9, 'a')) BETWEEN 19 AND 21,
  (SELECT string_agg(result::text, ' ') FROM public.t_json WHERE label LIKE 's9_%');

-- Leave reconciliation OFF for any later suite.
UPDATE public.app_settings SET value = '0'::jsonb WHERE key = 'call_agora_reconcile_enabled';
