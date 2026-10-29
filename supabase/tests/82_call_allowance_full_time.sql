\set ON_ERROR_STOP on
-- 20260101006600: the free 30 s are real talk time (clock starts when both phones are connected, not when the
-- tokens were issued), can be split across calls, and no new call can be started once they are used up.
-- Runs after 72 (reuses t72_* helpers, t_calls, t_json, t_results).
INSERT INTO public.app_settings (key, value) VALUES
  ('call_join_slack_seconds', '10'::jsonb), ('call_free_daily_seconds', '30'::jsonb),
  ('call_premium_daily_seconds', '300'::jsonb), ('call_daily_allowance_enabled', '1'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO auth.users(id, email) VALUES
  ('82000000-0000-0000-0000-00000000000a', 'f82-a@x'),   -- free caller
  ('82000000-0000-0000-0000-00000000000b', 'f82-b@x'),   -- recipient
  ('82000000-0000-0000-0000-00000000000c', 'f82-c@x'),   -- premium caller
  ('82000000-0000-0000-0000-00000000000d', 'f82-d@x');   -- recipient
CALL public.test_complete_profile('82000000-0000-0000-0000-00000000000a', 'F82A', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('82000000-0000-0000-0000-00000000000b', 'F82B', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('82000000-0000-0000-0000-00000000000c', 'F82C', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('82000000-0000-0000-0000-00000000000d', 'F82D', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('82aaaaaa-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b'),
  ('82aaaaaa-0000-0000-0000-0000000000a2', '82000000-0000-0000-0000-00000000000c', '82000000-0000-0000-0000-00000000000d');
INSERT INTO public.user_subscriptions(user_id, tier, status, starts_at, expires_at) VALUES
  ('82000000-0000-0000-0000-00000000000c', 'premium', 'active', now() - interval '1 day', now() + interval '10 days');

-- Both phones get tokens, take _connect_secs to connect, then both report connected.
CREATE FUNCTION public.t82_connect(_label text, _caller uuid, _recipient uuid, _connect_secs integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE _id uuid := public.t72_id(_label);
BEGIN
  PERFORM public.get_call_join_context(_id, _recipient);
  PERFORM public.get_call_join_context(_id, _caller);
  PERFORM public.t72_shift(_label, _connect_secs);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _caller::text, true);
  PERFORM public.mark_call_connected(_id);
  PERFORM set_config('request.jwt.claim.sub', _recipient::text, true);
  INSERT INTO public.t_json SELECT 'conn_' || _label, public.mark_call_connected(_id);
  PERFORM set_config('role', 'postgres', true);
END $$;
CREATE FUNCTION public.t82_create(_match uuid, _caller uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _caller::text, true);
  _r := public.create_video_call(_match, 'video');
  PERFORM set_config('role', 'postgres', true);
  RETURN _r;
END $$;

-- ===== A. Connecting time is not charged: 8 s to connect still leaves the full 30 s of talk =====
SELECT public.t72_call('f82_1', '82aaaaaa-0000-0000-0000-0000000000a1',
  '82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b');
SELECT public.t82_connect('f82_1', '82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b', 8);
INSERT INTO public.t_results SELECT 'full time: clock starts when both phones connect, not at token issue',
  c.allowance_started_at > greatest(c.caller_join_granted_at, c.recipient_join_granted_at) + interval '7 seconds'
  AND extract(epoch FROM (c.free_call_until - c.allowance_started_at)) = 30
  AND ((SELECT result FROM public.t_json WHERE label = 'conn_f82_1')->>'seconds_remaining')::int BETWEEN 29 AND 30,
  c.allowance_started_at::text
FROM public.video_calls c WHERE c.id = public.t72_id('f82_1');

-- ===== B. Split: hang up after 15 s, 15 s remain, a second call may be made =====
SELECT public.t72_shift('f82_1', 15);
SELECT public.t72_end('f82_1', '82000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'split: 15 s used after hanging up at 15 s',
  public.t72_used('82000000-0000-0000-0000-00000000000a') = 15,
  public.t72_used('82000000-0000-0000-0000-00000000000a')::text;
INSERT INTO public.t_json SELECT 'f82_c2', public.t82_create('82aaaaaa-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'split: a second call is allowed with 15 s left',
  (result->>'success')::boolean, result::text FROM public.t_json WHERE label = 'f82_c2';
-- Accept it, talk the remaining 15 s.
SET ROLE authenticated; SET request.jwt.claim.sub = '82000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'acc_f82_2', public.transition_video_call(
  ((SELECT result FROM public.t_json WHERE label = 'f82_c2')->>'call_id')::uuid, 'accept');
RESET ROLE;
INSERT INTO public.t_calls SELECT 'f82_2', ((SELECT result FROM public.t_json WHERE label = 'f82_c2')->>'call_id')::uuid;
SELECT public.t82_connect('f82_2', '82000000-0000-0000-0000-00000000000a', '82000000-0000-0000-0000-00000000000b', 3);
INSERT INTO public.t_results SELECT 'split: second call gets exactly the 15 s left',
  extract(epoch FROM (c.free_call_until - c.allowance_started_at)) = 15, c.billing_free_seconds::text
FROM public.video_calls c WHERE c.id = public.t72_id('f82_2');
SELECT public.t72_shift('f82_2', 16);
SELECT public.t72_end('f82_2', '82000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'split: 15 s + 15 s = the whole 30 s used',
  public.t72_used('82000000-0000-0000-0000-00000000000a') = 30,
  public.t72_used('82000000-0000-0000-0000-00000000000a')::text;

-- ===== C. Used up: no new call, nobody is rung =====
INSERT INTO public.t_json SELECT 'f82_c3', public.t82_create('82aaaaaa-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'used up: free caller cannot start another call today',
  result->>'success' = 'false' AND result->>'error' = 'daily_call_allowance_used' AND result->>'is_free' = 'true'
  AND result ? 'next_renewal_at', result::text FROM public.t_json WHERE label = 'f82_c3';
INSERT INTO public.t_results SELECT 'used up: no call row was created (no ringing)',
  count(*) = 2, count(*)::text FROM public.video_calls WHERE caller_id = '82000000-0000-0000-0000-00000000000a';
SET ROLE authenticated; SET request.jwt.claim.sub = '82000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'f82_al', public.get_my_video_call_allowance();
RESET ROLE;
INSERT INTO public.t_results SELECT 'used up: allowance RPC says exhausted',
  result->>'status' = 'exhausted' AND (result->>'seconds_remaining')::int = 0, result::text
FROM public.t_json WHERE label = 'f82_al';
-- The recipient can still call back on their own allowance (the caller pays).
INSERT INTO public.t_json SELECT 'f82_cb', public.t82_create('82aaaaaa-0000-0000-0000-0000000000a1', '82000000-0000-0000-0000-00000000000b');
INSERT INTO public.t_results SELECT 'used up: the other person can still call on their own time',
  (result->>'success')::boolean, result::text FROM public.t_json WHERE label = 'f82_cb';

-- ===== D. Premium: 300 s, also refused once used =====
SELECT public.t72_call('f82_p', '82aaaaaa-0000-0000-0000-0000000000a2',
  '82000000-0000-0000-0000-00000000000c', '82000000-0000-0000-0000-00000000000d');
INSERT INTO public.t_results SELECT 'premium: a call is covered for 300 s',
  c.billing_free_seconds = 300, c.billing_free_seconds::text FROM public.video_calls c WHERE c.id = public.t72_id('f82_p');
SELECT public.t82_connect('f82_p', '82000000-0000-0000-0000-00000000000c', '82000000-0000-0000-0000-00000000000d', 2);
SELECT public.t72_shift('f82_p', 301);
SELECT public.t72_end('f82_p', '82000000-0000-0000-0000-00000000000c');
INSERT INTO public.t_json SELECT 'f82_pc', public.t82_create('82aaaaaa-0000-0000-0000-0000000000a2', '82000000-0000-0000-0000-00000000000c');
INSERT INTO public.t_results SELECT 'premium: no new call after the 5 minutes are used',
  result->>'error' = 'daily_call_allowance_used' AND result->>'is_free' = 'false', result::text
FROM public.t_json WHERE label = 'f82_pc';

INSERT INTO public.app_settings (key, value) VALUES ('call_join_slack_seconds', '0'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
