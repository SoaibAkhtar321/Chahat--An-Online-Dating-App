\set ON_ERROR_STOP on
-- Server-authorized call invitations, participant checks, transitions, and duration rules.

INSERT INTO auth.users(id, email) VALUES
  ('60000000-0000-0000-0000-000000000001', 'call-a@x'),
  ('60000000-0000-0000-0000-000000000002', 'call-b@x'),
  ('60000000-0000-0000-0000-000000000003', 'call-c@x');

INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'photos', id || '/video-test.jpg', id::uuid
FROM public.profiles
WHERE id IN (
  '60000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000003'
);

UPDATE public.profiles
SET name = 'Caller', dob = '1995-01-01', gender = 'man', seeking = 'woman',
    city = 'Pune', bio = 'A complete video call test profile.',
    intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object(
      'id', 'video-test', 'path', id || '/video-test.jpg', 'thumbPath', id || '/video-test.jpg'
    )),
    onboarded = true
WHERE id = '60000000-0000-0000-0000-000000000001';
UPDATE public.profiles
SET name = 'Recipient', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Pune', bio = 'A complete video call test profile.',
    intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object(
      'id', 'video-test', 'path', id || '/video-test.jpg', 'thumbPath', id || '/video-test.jpg'
    )),
    onboarded = true
WHERE id IN ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002'),
  ('dddddddd-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003');

SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE first_call AS
SELECT (public.create_video_call('dddddddd-0000-0000-0000-000000000001', 'video')->>'call_id')::uuid AS id;
INSERT INTO public.t_results VALUES ('matched caller can request video call', (SELECT id IS NOT NULL FROM first_call), 'created');
CALL public.expect_fail('duplicate active call is rejected',
  'SELECT public.create_video_call(''dddddddd-0000-0000-0000-000000000001'', ''video'')');
CALL public.expect_fail('invalid call type rejected',
  'SELECT public.create_video_call(''dddddddd-0000-0000-0000-000000000002'', ''screen_share'')');
CALL public.expect_fail('caller cannot impersonate recipient acceptance',
  $q$SELECT public.transition_video_call((SELECT id FROM first_call), 'accept')$q$);
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000003';
INSERT INTO public.t_results
SELECT 'non-participant cannot read private call row', count(*) = 0, count(*)::text
FROM public.video_calls
WHERE id = (SELECT id FROM first_call);
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000002';
SELECT public.transition_video_call((SELECT id FROM first_call), 'accept');
INSERT INTO public.t_results
-- Since 20260101005500 accept adds a connect grace (default 30 s); the 60 s clock restarts once both connect.
SELECT 'free call receives server-owned 60-second allowance plus connect grace',
  free_seconds_remaining BETWEEN 61 AND 90, coalesce(free_seconds_remaining::text, 'null')
FROM public.get_my_video_calls() WHERE id = (SELECT id FROM first_call);
CALL public.expect_fail('decline after accept is invalid',
  $q$SELECT public.transition_video_call((SELECT id FROM first_call), 'decline')$q$);
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
SELECT public.transition_video_call((SELECT id FROM first_call), 'end');
INSERT INTO public.t_results
SELECT 'participant can end accepted call', status = 'ended', status
FROM public.video_calls WHERE id = (SELECT id FROM first_call);
RESET ROLE;

INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES
  ('60000000-0000-0000-0000-000000000001', 'premium', 'active', now() + interval '30 days'),
  ('60000000-0000-0000-0000-000000000003', 'vip', 'active', now() + interval '30 days');
SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE paid_call AS
SELECT (public.create_video_call('dddddddd-0000-0000-0000-000000000002', 'audio')->>'call_id')::uuid AS id;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000003';
SELECT public.transition_video_call((SELECT id FROM paid_call), 'accept');
INSERT INTO public.t_results
SELECT 'both paid participants have no free-call cap',
  free_seconds_remaining IS NULL, coalesce(free_seconds_remaining::text, 'unlimited')
FROM public.get_my_video_calls() WHERE id = (SELECT id FROM paid_call);
RESET ROLE;

UPDATE public.video_calls SET status = 'pending', expires_at = now() - interval '1 second'
WHERE id = (SELECT id FROM paid_call);
SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
SELECT * FROM public.get_my_video_calls() WHERE id = (SELECT id FROM paid_call);
INSERT INTO public.t_results
SELECT 'expired invitations are server-closed', status = 'timed_out', status
FROM public.video_calls WHERE id = (SELECT id FROM paid_call);
RESET ROLE;
