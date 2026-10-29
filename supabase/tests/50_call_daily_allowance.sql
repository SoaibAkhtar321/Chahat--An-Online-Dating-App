\set ON_ERROR_STOP on
-- Daily call allowance: free = 15 s/day, premium = 300 s/day (IST day). Runs after 43 (reuses t_calls, t_json, t_shift).
INSERT INTO public.app_settings (key, value) VALUES
  ('call_daily_allowance_enabled', '1'::jsonb), ('call_free_daily_seconds', '15'::jsonb),
  ('call_premium_daily_seconds', '300'::jsonb), ('call_free_seconds', '60'::jsonb),
  ('call_extension_lead_seconds', '20'::jsonb), ('call_rate_video_coins_per_minute', '10'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO auth.users(id, email) VALUES
  ('71000000-0000-0000-0000-00000000000a', 'allow-a@x'),
  ('71000000-0000-0000-0000-00000000000b', 'allow-b@x'),
  ('71000000-0000-0000-0000-00000000000c', 'allow-c@x'),
  ('71000000-0000-0000-0000-00000000000d', 'allow-d@x'),
  ('71000000-0000-0000-0000-00000000000e', 'allow-e@x'),
  ('71000000-0000-0000-0000-00000000000f', 'allow-f@x');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000a', 'AllowA', '1997-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000b', 'AllowB', '1998-01-01', 'woman', 'man');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000c', 'AllowC', '1999-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000d', 'AllowD', '1990-01-01', 'woman', 'man');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000e', 'AllowE', '1991-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-00000000000f', 'AllowF', '1992-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('eeeeeeee-0000-0000-0000-0000000000b1', '71000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000b'),
  ('eeeeeeee-0000-0000-0000-0000000000b2', '71000000-0000-0000-0000-00000000000c', '71000000-0000-0000-0000-00000000000d'),
  ('eeeeeeee-0000-0000-0000-0000000000b3', '71000000-0000-0000-0000-00000000000e', '71000000-0000-0000-0000-00000000000f');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES
  ('71000000-0000-0000-0000-00000000000c', 'premium', 'active', now() + interval '30 days');

SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'al1', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'acc_al1', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al1'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: a free caller gets a 15 s window (not 60 s) and is metered',
  NOT billing_exempt AND billing_free_seconds = 15 AND free_call_until BETWEEN now() + interval '13 seconds' AND now() + interval '16 seconds', billing_free_seconds::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al1');
SELECT public.t_shift('al1', 10);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al1'), 'end');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'al2', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'acc_al2', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al2'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: after 10 s used, the next call gets only the remaining 5 s',
  billing_free_seconds BETWEEN 4 AND 5 AND NOT billing_exempt, billing_free_seconds::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al2');
SELECT public.t_shift('al2', 5);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al2'), 'end');
RESET ROLE;
-- 20260101006600: with the free time used and no coins, the call cannot even be created (nobody is rung).
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'cr_al3', public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b1', 'video');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: with 15 s used and no coins a new call is refused before ringing',
  NOT (result->>'success')::boolean AND result->>'error' = 'daily_call_allowance_used' AND NOT result ? 'call_id', result::text
FROM public.t_json WHERE label = 'cr_al3';
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
SELECT public.credit_coins_from_purchase('71000000-0000-0000-0000-00000000000a', 100, 'ORDER-ALLOW-0001');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'al4', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'acc_al4', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al4'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: a free caller out of free time can continue with coins (minute 1 charged at accept)',
  NOT billing_exempt AND billing_free_seconds = 0 AND billed_minutes = 1 AND coins_charged = 10
  AND free_call_until BETWEEN now() + interval '58 seconds' AND now() + interval '61 seconds'
  AND public.t_balance('71000000-0000-0000-0000-00000000000a') = 90, public.t_balance('71000000-0000-0000-0000-00000000000a')::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al4');
SELECT public.t_shift('al4', 0);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al4'), 'end');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_calls SELECT 'al5', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b2', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000d';
INSERT INTO public.t_json SELECT 'acc_al5', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al5'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: a premium caller gets a 300 s window, exempt from coins',
  billing_exempt AND billing_free_seconds = 300 AND billing_rate_coins IS NULL
  AND free_call_until BETWEEN now() + interval '298 seconds' AND now() + interval '301 seconds', billing_free_seconds::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al5');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_al5', public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'al5'), '71000000-0000-0000-0000-00000000000d');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: premium coverage is never extended and never charged',
  (result->>'ok')::boolean AND NOT (result->>'extended')::boolean AND (result->>'exempt')::boolean
  AND (result->>'covered_seconds_remaining')::int BETWEEN 295 AND 300
  AND (SELECT count(*) FROM public.coin_transactions WHERE user_id = '71000000-0000-0000-0000-00000000000c') = 0, result::text
FROM public.t_json WHERE label = 'ext_al5';
SELECT public.t_shift('al5', 300);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000c';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al5'), 'end');
RESET ROLE;
-- 20260101006600: refused at create, before anyone is rung.
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_json SELECT 'cr_al6', public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b2', 'video');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: premium caller who used 300 s today is refused (no coin path)',
  NOT (result->>'success')::boolean AND result->>'error' = 'daily_call_allowance_used' AND result->>'is_free' = 'false', result::text
FROM public.t_json WHERE label = 'cr_al6';
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000e';
INSERT INTO public.t_calls SELECT 'al7', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b3', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000f';
INSERT INTO public.t_json SELECT 'acc_al7', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al7'), 'accept');
RESET ROLE;
SET ROLE service_role; SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_al7', public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'al7'), '71000000-0000-0000-0000-00000000000f');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: the 15 s free window is not extended/charged at the start of the call',
  (result->>'ok')::boolean AND NOT (result->>'extended')::boolean
  AND (result->>'covered_seconds_remaining')::int BETWEEN 13 AND 15
  AND (SELECT coins_charged FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al7')) = 0, result::text
FROM public.t_json WHERE label = 'ext_al7';
SELECT public.t_shift('al7', 0);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000e';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al7'), 'end');
RESET ROLE;
UPDATE public.video_calls SET accepted_at = accepted_at - interval '2 days', ended_at = ended_at - interval '2 days'
 WHERE caller_id = '71000000-0000-0000-0000-00000000000e';
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000e';
INSERT INTO public.t_calls SELECT 'al8', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b3', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000f';
INSERT INTO public.t_json SELECT 'acc_al8', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al8'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: it renews on the next IST day (yesterday''s usage no longer counts)',
  billing_free_seconds = 15, billing_free_seconds::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al8');
SELECT public.t_shift('al8', 0);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000e';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al8'), 'end');
RESET ROLE;
UPDATE public.app_settings SET value = '0'::jsonb WHERE key = 'call_daily_allowance_enabled';
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_calls SELECT 'al9', (public.create_video_call('eeeeeeee-0000-0000-0000-0000000000b2', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000d';
INSERT INTO public.t_json SELECT 'acc_al9', public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al9'), 'accept');
RESET ROLE;
INSERT INTO public.t_results SELECT 'allowance: switching it off restores legacy premium (unmetered)',
  billing_exempt AND free_call_until IS NULL, 'legacy'
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'al9');
SELECT public.t_shift('al9', 0);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-00000000000c';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'al9'), 'end');
RESET ROLE;
UPDATE public.app_settings SET value = '1'::jsonb WHERE key = 'call_daily_allowance_enabled';
