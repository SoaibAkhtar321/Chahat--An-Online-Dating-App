\set ON_ERROR_STOP on
-- Push-token ownership, server-created notification events, and preference isolation.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'push-a@x'),
  ('00000000-0000-0000-0000-0000000000f2', 'push-b@x');
-- Step 3: activating a push token requires the user's push consent (see 52_optional_consents.sql for the consent tests).
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'push_notifications', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');

-- Notification triggers only fire for active, onboarded, non-demo profiles.
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000f1', 'Push A', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000f2', 'Push B', '1995-01-01', 'woman', 'man');
SET request.jwt.claim.role = 'authenticated';

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
CALL public.expect_ok(
  'authenticated user registers a valid Expo push token',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[12345678-1234-1234-1234-123456789abc]', 'android', '1.0.0'
  )$q$
);
CALL public.expect_ok(
  'same owner can idempotently refresh an Expo push token',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[12345678-1234-1234-1234-123456789abc]', 'ios', '1.0.1'
  )$q$
);
CALL public.expect_ok(
  'same account can register a second device',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[32345678-1234-1234-1234-123456789abc]', 'android', '1.0.0'
  )$q$
);
CALL public.expect_ok(
  'token refresh replaces only the same account device token',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[42345678-1234-1234-1234-123456789abc]', 'android', '1.0.1',
    'ExponentPushToken[32345678-1234-1234-1234-123456789abc]'
  )$q$
);
CALL public.expect_fail(
  'malformed Expo push token is rejected',
  $q$SELECT public.register_push_device('fcm_mock_not_real', 'android', '1.0.0')$q$
);
INSERT INTO public.notification_preferences (user_id, likes)
VALUES (auth.uid(), false);
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
CALL public.expect_ok(
  'second account can register a separate device',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[22345678-1234-1234-1234-123456789abc]', 'ios', '1.0.0'
  )$q$
);
CALL public.expect_fail(
  'another account cannot reassign an existing push token',
  $q$SELECT public.register_push_device(
    'ExponentPushToken[12345678-1234-1234-1234-123456789abc]', 'android', '1.0.0'
  )$q$
);
INSERT INTO public.t_results
SELECT 'another account cannot read notification preferences',
  count(*) = 0,
  count(*)::text
FROM public.notification_preferences
WHERE user_id = '00000000-0000-0000-0000-0000000000f1';
CALL public.expect_fail(
  'another account cannot modify notification preferences',
  $q$INSERT INTO public.notification_preferences(user_id, likes)
     VALUES ('00000000-0000-0000-0000-0000000000f1', true)
     ON CONFLICT (user_id) DO UPDATE SET likes = EXCLUDED.likes$q$
);
CALL public.expect_fail(
  'clients cannot read raw push tokens',
  $q$SELECT token FROM public.push_devices$q$
);
CALL public.expect_fail(
  'clients cannot claim dispatch jobs',
  $q$SELECT * FROM public.claim_push_deliveries(10)$q$
);
SELECT public.unregister_push_device(
  'ExponentPushToken[12345678-1234-1234-1234-123456789abc]'
);
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_results
SELECT 'account has both active devices after token rotation',
  count(*) = 2,
  count(*)::text
FROM public.push_devices
WHERE user_id = '00000000-0000-0000-0000-0000000000f1' AND active;
-- Phase 2: a like only notifies while unanswered, so the pair is inserted sequentially: f1's like
-- notifies f2; f2's reciprocal like is a match, not a "someone likes you" event.
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'like');
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'like');
-- The legacy on_swipe auto-match trigger was removed (matches come from record_swipe),
-- so create the mutual match explicitly.
INSERT INTO public.matches (user_a, user_b)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.messages(match_id, sender, body)
SELECT id, '00000000-0000-0000-0000-0000000000f1', 'private message body must not enter push payload'
FROM public.matches
WHERE user_a = '00000000-0000-0000-0000-0000000000f1'
  AND user_b = '00000000-0000-0000-0000-0000000000f2';

INSERT INTO public.t_results
SELECT 'likes, mutual matches, and messages enqueue server-owned events',
  count(*) = 4,
  count(*)::text
FROM public.notification_outbox
WHERE (recipient_id = '00000000-0000-0000-0000-0000000000f2' AND category = 'like')
   OR (category = 'match' AND event_id IN (
     SELECT id::text FROM public.matches
     WHERE user_a = '00000000-0000-0000-0000-0000000000f1'
       AND user_b = '00000000-0000-0000-0000-0000000000f2'
   ))
   OR (category = 'message' AND route_data->>'matchId' IN (
     SELECT id::text FROM public.matches
     WHERE user_a = '00000000-0000-0000-0000-0000000000f1'
       AND user_b = '00000000-0000-0000-0000-0000000000f2'
   ));
INSERT INTO public.t_results
SELECT 'notification outbox never includes message content',
  bool_and(route_data::text NOT LIKE '%private message body%'),
  bool_and(route_data::text NOT LIKE '%private message body%')::text
FROM public.notification_outbox
WHERE category = 'message';

INSERT INTO public.notification_preferences (user_id, likes)
VALUES ('00000000-0000-0000-0000-0000000000f2', false)
ON CONFLICT (user_id) DO UPDATE SET likes = false;
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results
SELECT 'server preferences suppress likes before device delivery',
  count(*) = 0,
  count(*)::text
FROM public.notification_deliveries d
JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.recipient_id = '00000000-0000-0000-0000-0000000000f2'
  AND o.category = 'like';
RESET ROLE;
