\set ON_ERROR_STOP on
-- Chahat Phase 1: match/message/like events, display context, block + source suppression at dispatch time.
INSERT INTO auth.users(id, email) VALUES
  ('56565656-0000-0000-0000-000000000001', 'p1-sender@x'),
  ('56565656-0000-0000-0000-000000000002', 'p1-recipient@x'),
  ('56565656-0000-0000-0000-000000000003', 'p1-third@x');
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'push_notifications', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id IN ('56565656-0000-0000-0000-000000000002', '56565656-0000-0000-0000-000000000003');
CALL public.test_complete_profile('56565656-0000-0000-0000-000000000001', 'Sender Alpha', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('56565656-0000-0000-0000-000000000002', 'Recipient Beta', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('56565656-0000-0000-0000-000000000003', 'Third Gamma', '1995-01-01', 'woman', 'man');
INSERT INTO public.push_devices (user_id, token, platform) VALUES
  ('56565656-0000-0000-0000-000000000002', 'ExponentPushToken[p1recipientdevice0001]', 'android'),
  ('56565656-0000-0000-0000-000000000002', 'ExponentPushToken[p1recipientdevice0002]', 'android'),
  ('56565656-0000-0000-0000-000000000003', 'ExponentPushToken[p1thirddevice00000001]', 'android');

-- ---- Likes: priority likes enqueue the generic like event; passes do not; no sender identity in outbox ----
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('56565656-0000-0000-0000-000000000001', '56565656-0000-0000-0000-000000000002', 'priority');
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('56565656-0000-0000-0000-000000000003', '56565656-0000-0000-0000-000000000001', 'pass');
INSERT INTO public.t_results SELECT 'p1: priority like enqueues exactly one like event',
  count(*) = 1, count(*)::text FROM public.notification_outbox
  WHERE recipient_id = '56565656-0000-0000-0000-000000000002' AND category = 'like';
INSERT INTO public.t_results SELECT 'p1: pass never enqueues a notification',
  count(*) = 0, count(*)::text FROM public.notification_outbox
  WHERE recipient_id = '56565656-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p1: like event route data carries no sender or profile id',
  count(*) = 1 AND bool_and(route_data = '{}'::jsonb), 'route_data empty'
  FROM public.notification_outbox WHERE category = 'like' AND actor_id = '56565656-0000-0000-0000-000000000001';

-- ---- Match: both users notified once; duplicate event insert is a no-op; later like does not double-notify ----
INSERT INTO public.matches (user_a, user_b)
VALUES ('56565656-0000-0000-0000-000000000001', '56565656-0000-0000-0000-000000000002');
INSERT INTO public.t_results SELECT 'p1: genuine match notifies both users once each',
  count(*) = 2 AND count(DISTINCT recipient_id) = 2, count(*)::text
  FROM public.notification_outbox WHERE category = 'match'
  AND event_id IN (SELECT id::text FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001');
INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id)
SELECT recipient_id, actor_id, category, event_id FROM public.notification_outbox
WHERE category = 'match' AND (actor_id = '56565656-0000-0000-0000-000000000001' OR recipient_id = '56565656-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
INSERT INTO public.t_results SELECT 'p1: duplicate match event is rejected by the unique key',
  count(*) = 2, count(*)::text FROM public.notification_outbox
  WHERE category = 'match' AND (actor_id = '56565656-0000-0000-0000-000000000001' OR recipient_id = '56565656-0000-0000-0000-000000000001'::uuid);
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('56565656-0000-0000-0000-000000000002', '56565656-0000-0000-0000-000000000001', 'like');
INSERT INTO public.t_results SELECT 'p1: a like between already-matched users does not enqueue a like push',
  count(*) = 0, count(*)::text FROM public.notification_outbox
  WHERE recipient_id = '56565656-0000-0000-0000-000000000001' AND category = 'like';

-- ---- Messages: text/image enqueue; system rows do not ----
INSERT INTO public.messages(match_id, sender, body)
SELECT id, '56565656-0000-0000-0000-000000000001', E'  hello   there\n friend  '
FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001' AND user_b = '56565656-0000-0000-0000-000000000002';
INSERT INTO public.messages(match_id, sender, body, image_path, message_type)
SELECT id, '56565656-0000-0000-0000-000000000001', '', id::text || '/photo1.jpg', 'image'
FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001' AND user_b = '56565656-0000-0000-0000-000000000002';
INSERT INTO public.messages(match_id, sender, body, message_type)
SELECT id, '56565656-0000-0000-0000-000000000001', 'system note', 'system'
FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001' AND user_b = '56565656-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'p1: text and image messages enqueue, system message does not',
  count(*) = 2, count(*)::text FROM public.notification_outbox
  WHERE category = 'message' AND actor_id = '56565656-0000-0000-0000-000000000001' AND recipient_id = '56565656-0000-0000-0000-000000000002'::uuid;

-- ---- Display context is service-role only, never for clients ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '56565656-0000-0000-0000-000000000002';
CALL public.expect_fail('p1: authenticated clients cannot read push display context',
  $q$SELECT * FROM public.get_push_display_context(ARRAY[gen_random_uuid()])$q$);
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
RESET request.jwt.claim.sub;
-- default preference ("name"): first name, no preview
CREATE TEMP TABLE p1_ctx AS
SELECT o.category, o.event_id, c.sender_name, c.preview
FROM public.notification_outbox o
CROSS JOIN LATERAL public.get_push_display_context(ARRAY[o.id]) c
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'p1: default lock-screen detail is first name only, no preview',
  bool_and(sender_name IS NOT DISTINCT FROM CASE WHEN category IN ('match','message') THEN 'Sender' END AND preview IS NULL),
  string_agg(category || ':' || coalesce(sender_name, '-'), ',') FROM p1_ctx;
INSERT INTO public.t_results SELECT 'p1: like context never exposes the sender',
  bool_and(sender_name IS NULL AND preview IS NULL), count(*)::text FROM p1_ctx WHERE category = 'like';
DROP TABLE p1_ctx;

RESET ROLE;
INSERT INTO public.notification_preferences (user_id, lock_screen_details)
VALUES ('56565656-0000-0000-0000-000000000002', 'preview')
ON CONFLICT (user_id) DO UPDATE SET lock_screen_details = 'preview';
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
CREATE TEMP TABLE p1_ctx AS
SELECT o.category, m.message_type, c.sender_name, c.preview
FROM public.notification_outbox o
LEFT JOIN public.messages m ON o.category = 'message' AND m.id::text = o.event_id
CROSS JOIN LATERAL public.get_push_display_context(ARRAY[o.id]) c
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'p1: preview opt-in collapses whitespace in text messages',
  count(*) = 1, max(preview) FROM p1_ctx WHERE category = 'message' AND message_type = 'text' AND preview = 'hello there friend';
INSERT INTO public.t_results SELECT 'p1: preview never quotes media',
  count(*) = 1, max(preview) FROM p1_ctx WHERE message_type = 'image' AND preview = 'Sent you a photo';
INSERT INTO public.t_results SELECT 'p1: like context stays anonymous even with preview opt-in',
  bool_and(sender_name IS NULL AND preview IS NULL), count(*)::text FROM p1_ctx WHERE category = 'like';
DROP TABLE p1_ctx;

RESET ROLE;
UPDATE public.notification_preferences SET lock_screen_details = 'none'
WHERE user_id = '56565656-0000-0000-0000-000000000002';
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_results SELECT 'p1: "none" hides both name and preview',
  bool_and(c.sender_name IS NULL AND c.preview IS NULL), count(*)::text
FROM public.notification_outbox o CROSS JOIN LATERAL public.get_push_display_context(ARRAY[o.id]) c
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000002';
RESET ROLE;
CALL public.expect_fail('p1: invalid lock-screen detail value is rejected',
  $q$UPDATE public.notification_preferences SET lock_screen_details = 'everything' WHERE user_id = '56565656-0000-0000-0000-000000000002'$q$);

-- ---- Dispatch time: blocks placed AFTER enqueue must suppress delivery (no auth.uid() in service role) ----
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
INSERT INTO public.t_results SELECT 'p1: both recipient devices get a delivery per eligible event',
  count(DISTINCT device_id) = 2, count(*)::text
FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000002' AND o.category = 'match';
RESET ROLE;
INSERT INTO public.blocks (blocker, blocked)
VALUES ('56565656-0000-0000-0000-000000000002', '56565656-0000-0000-0000-000000000001');
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT count(*) FROM public.claim_push_deliveries(100);
INSERT INTO public.t_results SELECT 'p1: block placed after enqueue suppresses every pending delivery',
  count(*) > 0 AND bool_and(d.status = 'suppressed'), count(*)::text || ' suppressed'
FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000002';
RESET ROLE;

-- ---- Source row removed (unmatched) before dispatch: match/message pushes are suppressed, not sent ----
INSERT INTO public.matches (user_a, user_b)
VALUES ('56565656-0000-0000-0000-000000000001', '56565656-0000-0000-0000-000000000003');
INSERT INTO public.messages(match_id, sender, body)
SELECT id, '56565656-0000-0000-0000-000000000001', 'will be unmatched'
FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001' AND user_b = '56565656-0000-0000-0000-000000000003';
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
RESET ROLE;
DELETE FROM public.matches WHERE user_a = '56565656-0000-0000-0000-000000000001' AND user_b = '56565656-0000-0000-0000-000000000003';
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_results SELECT 'p1: nothing is claimed for an unmatched conversation',
  count(*) = 0, count(*)::text FROM public.claim_push_deliveries(100) c
  WHERE c.device_id IN (SELECT id FROM public.push_devices WHERE user_id = '56565656-0000-0000-0000-000000000003');
INSERT INTO public.t_results SELECT 'p1: unmatched deliveries are suppressed as SourceGone',
  count(*) >= 1 AND bool_and(d.status = 'suppressed' AND d.last_error = 'SourceGone'), count(*)::text
FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.recipient_id = '56565656-0000-0000-0000-000000000003';
RESET ROLE;
