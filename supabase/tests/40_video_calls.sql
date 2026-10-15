\set ON_ERROR_STOP on
-- Server-authorized call invitations, participant checks, transitions, and duration rules.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'call-a@x'),
  ('00000000-0000-0000-0000-0000000000d2', 'call-b@x'),
  ('00000000-0000-0000-0000-0000000000d3', 'call-c@x');
UPDATE public.profiles
SET name = 'Caller', dob = '1995-01-01', gender = 'man', seeking = 'woman',
    city = 'Pune', onboarded = true
WHERE id = '00000000-0000-0000-0000-0000000000d1';
UPDATE public.profiles
SET name = 'Recipient', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Pune', onboarded = true
WHERE id IN ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2'),
  ('dddddddd-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d3');

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
CREATE TEMP TABLE first_call AS
SELECT (public.create_video_call('dddddddd-0000-0000-0000-000000000001', 'video')->>'call_id')::uuid AS id;
INSERT INTO public.t_results VALUES ('matched caller can request video call', (SELECT id IS NOT NULL FROM first_call), 'created');
CALL public.expect_fail('duplicate active call is rejected',
  'SELECT public.create_video_call(''dddddddd-0000-0000-0000-000000000001'', ''video'')');
CALL public.expect_fail('invalid call type rejected',
  'SELECT public.create_video_call(''dddddddd-0000-0000-0000-000000000002'', ''screen_share'')');
CALL public.expect_fail('caller cannot impersonate recipient acceptance',
  format('SELECT public.transition_video_call(%L, %L)', (SELECT id FROM first_call), 'accept'));
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d3';
INSERT INTO public.t_results
SELECT 'non-participant cannot read private call row', count(*) = 0, count(*)::text
FROM public.video_calls
WHERE id = (SELECT id FROM first_call);
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
SELECT public.transition_video_call((SELECT id FROM first_call), 'accept');
INSERT INTO public.t_results
SELECT 'free call receives server-owned 60-second allowance',
  free_seconds_remaining BETWEEN 1 AND 60, coalesce(free_seconds_remaining::text, 'null')
FROM public.get_my_video_calls() WHERE id = (SELECT id FROM first_call);
CALL public.expect_fail('decline after accept is invalid',
  format('SELECT public.transition_video_call(%L, %L)', (SELECT id FROM first_call), 'decline'));
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
SELECT public.transition_video_call((SELECT id FROM first_call), 'end');
INSERT INTO public.t_results
SELECT 'participant can end accepted call', status = 'ended', status
FROM public.video_calls WHERE id = (SELECT id FROM first_call);
RESET ROLE;

INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'premium', 'active', now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000d3', 'vip', 'active', now() + interval '30 days');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
CREATE TEMP TABLE paid_call AS
SELECT (public.create_video_call('dddddddd-0000-0000-0000-000000000002', 'audio')->>'call_id')::uuid AS id;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d3';
SELECT public.transition_video_call((SELECT id FROM paid_call), 'accept');
INSERT INTO public.t_results
SELECT 'both paid participants have no free-call cap',
  free_seconds_remaining IS NULL, coalesce(free_seconds_remaining::text, 'unlimited')
FROM public.get_my_video_calls() WHERE id = (SELECT id FROM paid_call);
RESET ROLE;

UPDATE public.video_calls SET status = 'pending', expires_at = now() - interval '1 second'
WHERE id = (SELECT id FROM paid_call);
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
SELECT * FROM public.get_my_video_calls() WHERE id = (SELECT id FROM paid_call);
INSERT INTO public.t_results
SELECT 'expired invitations are server-closed', status = 'timed_out', status
FROM public.video_calls WHERE id = (SELECT id FROM paid_call);
RESET ROLE;
