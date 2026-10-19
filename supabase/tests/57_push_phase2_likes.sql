\set ON_ERROR_STOP on
-- Chahat Phase 2: premium likes notification flow. Entitlement, direct-access denial, validity rule,
-- dedupe/retry, blocks, suspension and delivery-time suppression.
-- Users: L1 liker, L2 second liker, R recipient (free), P premium recipient, X third party.
INSERT INTO auth.users(id, email) VALUES
  ('57575757-0000-0000-0000-0000000000a1', 'p2-liker1@x'),
  ('57575757-0000-0000-0000-0000000000a2', 'p2-liker2@x'),
  ('57575757-0000-0000-0000-0000000000b1', 'p2-free@x'),
  ('57575757-0000-0000-0000-0000000000b2', 'p2-premium@x'),
  ('57575757-0000-0000-0000-0000000000c1', 'p2-third@x');
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method) VALUES
  ('57575757-0000-0000-0000-0000000000b1', 'push_notifications', '2026-10-18', 'granted', 'in_app_notice'),
  ('57575757-0000-0000-0000-0000000000b2', 'push_notifications', '2026-10-18', 'granted', 'in_app_notice');
CALL public.test_complete_profile('57575757-0000-0000-0000-0000000000a1', 'Liker One', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('57575757-0000-0000-0000-0000000000a2', 'Liker Two', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('57575757-0000-0000-0000-0000000000b1', 'Free Recipient', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('57575757-0000-0000-0000-0000000000b2', 'Premium Recipient', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('57575757-0000-0000-0000-0000000000c1', 'Third Party', '1995-01-01', 'woman', 'man');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES ('57575757-0000-0000-0000-0000000000b2', 'premium', 'active', now() + interval '30 days');
INSERT INTO public.push_devices (user_id, token, platform) VALUES
  ('57575757-0000-0000-0000-0000000000b1', 'ExponentPushToken[p2freedevice000000001]', 'android'),
  ('57575757-0000-0000-0000-0000000000b2', 'ExponentPushToken[p2premdevice000000001]', 'android');

-- ---- Likes toward both recipients (inserted as the owner of the table, i.e. what record_swipe does) ----
INSERT INTO public.swipes(from_id, to_id, kind) VALUES
  ('57575757-0000-0000-0000-0000000000a1', '57575757-0000-0000-0000-0000000000b1', 'like'),
  ('57575757-0000-0000-0000-0000000000a2', '57575757-0000-0000-0000-0000000000b1', 'priority'),
  ('57575757-0000-0000-0000-0000000000a1', '57575757-0000-0000-0000-0000000000b2', 'like');
INSERT INTO public.t_results SELECT 'p2: each valid non-mutual like enqueues exactly one event',
  count(*) = 3, count(*)::text FROM public.notification_outbox
  WHERE category = 'like' AND event_id LIKE '57575757-%';

-- ---- Duplicate / retry: re-running the enqueue for the same pair is a no-op ----
INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id)
VALUES ('57575757-0000-0000-0000-0000000000b1'::uuid, '57575757-0000-0000-0000-0000000000a1', 'like',
        '57575757-0000-0000-0000-0000000000a1:57575757-0000-0000-0000-0000000000b1')
ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
INSERT INTO public.t_results SELECT 'p2: replayed like event does not duplicate',
  count(*) = 1, count(*)::text FROM public.notification_outbox
  WHERE category = 'like' AND recipient_id = '57575757-0000-0000-0000-0000000000b1'::uuid
    AND actor_id = '57575757-0000-0000-0000-0000000000a1';

-- ---- Free member: access says not eligible, identities denied everywhere ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '57575757-0000-0000-0000-0000000000b1';
INSERT INTO public.t_results SELECT 'p2: free member is not eligible and receives NO count',
  (a->>'eligible')::boolean = false AND NOT (a ? 'count') AND a = '{"eligible": false}'::jsonb, a::text
  FROM (SELECT public.get_my_likes_access() a) q;
INSERT INTO public.t_results SELECT 'p2: access response contains no identity fields',
  NOT (a ? 'id' OR a ? 'name' OR a ? 'from_id' OR a ? 'likers'), a::text
  FROM (SELECT public.get_my_likes_access() a) q;
CALL public.expect_fail('p2: free member cannot call the legacy get_incoming_likes_count',
  $q$SELECT public.get_incoming_likes_count()$q$);
CALL public.expect_fail('p2: free member cannot call get_received_likes',
  $q$SELECT * FROM public.get_received_likes(50, NULL)$q$);
INSERT INTO public.t_results SELECT 'p2: free member direct swipes read returns no received likes',
  count(*) = 0, count(*)::text FROM public.swipes WHERE to_id = '57575757-0000-0000-0000-0000000000b1';
-- Fabricated entitlement flags in the JWT are ignored.
SET request.jwt.claims = '{"role":"authenticated","sub":"57575757-0000-0000-0000-0000000000b1","tier":"vip","app_metadata":{"tier":"vip","premium":true},"user_metadata":{"tier":"vip"}}';
CALL public.expect_fail('p2: fabricated vip claim does not unlock likes',
  $q$SELECT * FROM public.get_received_likes(50, NULL)$q$);
INSERT INTO public.t_results SELECT 'p2: fabricated vip claim does not change eligibility or reveal a count',
  public.get_my_likes_access() = '{"eligible": false}'::jsonb, 'claims ignored';
CALL public.expect_fail('p2: fabricated vip claim cannot read the legacy count',
  $q$SELECT public.get_incoming_likes_count()$q$);
RESET request.jwt.claims;
RESET ROLE;

-- ---- Premium member: list works, correct rows, no direct table read either ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '57575757-0000-0000-0000-0000000000b2';
INSERT INTO public.t_results SELECT 'p2: premium member is eligible with one valid like',
  (a->>'eligible')::boolean AND (a->>'count')::int = 1, a::text
  FROM (SELECT public.get_my_likes_access() a) q;
INSERT INTO public.t_results SELECT 'p2: premium member can read the count via the legacy RPC too',
  public.get_incoming_likes_count() = 1, public.get_incoming_likes_count()::text;
INSERT INTO public.t_results SELECT 'p2: premium list returns the liker',
  count(*) = 1 AND bool_and(id = '57575757-0000-0000-0000-0000000000a1' AND name = 'Liker One'), count(*)::text
  FROM public.get_received_likes(50, NULL);
INSERT INTO public.t_results SELECT 'p2: premium direct swipes read is also closed (RPC is the only path)',
  count(*) = 0, count(*)::text FROM public.swipes WHERE to_id = '57575757-0000-0000-0000-0000000000b2';
CALL public.expect_fail('p2: invalid limit rejected', $q$SELECT * FROM public.get_received_likes(0, NULL)$q$);
RESET ROLE;

-- ---- Anonymous / other roles ----
SET ROLE anon;
CALL public.expect_fail('p2: anon cannot call get_received_likes', $q$SELECT * FROM public.get_received_likes(50, NULL)$q$);
CALL public.expect_fail('p2: anon cannot call get_my_likes_access', $q$SELECT public.get_my_likes_access()$q$);
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '57575757-0000-0000-0000-0000000000b2';
CALL public.expect_fail('p2: internal validity rule is not callable by clients',
  $q$SELECT public._like_is_valid('57575757-0000-0000-0000-0000000000a1','57575757-0000-0000-0000-0000000000b2')$q$);
RESET ROLE;

-- ---- Expired subscription loses access immediately ----
UPDATE public.user_subscriptions SET expires_at = now() - interval '1 minute'
WHERE user_id = '57575757-0000-0000-0000-0000000000b2';
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '57575757-0000-0000-0000-0000000000b2';
CALL public.expect_fail('p2: expired subscription is denied', $q$SELECT * FROM public.get_received_likes(50, NULL)$q$);
INSERT INTO public.t_results SELECT 'p2: expired subscription gets no count',
  public.get_my_likes_access() = '{"eligible": false}'::jsonb, public.get_my_likes_access()::text;
RESET ROLE;
UPDATE public.user_subscriptions SET expires_at = now() + interval '30 days'
WHERE user_id = '57575757-0000-0000-0000-0000000000b2';

-- ---- Validity: blocks, answered likes, suspension ----
INSERT INTO public.blocks (blocker, blocked)
VALUES ('57575757-0000-0000-0000-0000000000b2', '57575757-0000-0000-0000-0000000000a1');
INSERT INTO public.t_results SELECT 'p2: blocked like is invalid',
  NOT public._like_is_valid('57575757-0000-0000-0000-0000000000a1','57575757-0000-0000-0000-0000000000b2'), 'blocked';
DELETE FROM public.blocks WHERE blocker = '57575757-0000-0000-0000-0000000000b2';

INSERT INTO public.swipes(from_id, to_id, kind)
VALUES ('57575757-0000-0000-0000-0000000000b1', '57575757-0000-0000-0000-0000000000a1', 'pass');
INSERT INTO public.t_results SELECT 'p2: a like the recipient passed on is no longer valid',
  NOT public._like_is_valid('57575757-0000-0000-0000-0000000000a1','57575757-0000-0000-0000-0000000000b1'), 'answered';

INSERT INTO public.swipes(from_id, to_id, kind)
VALUES ('57575757-0000-0000-0000-0000000000b2', '57575757-0000-0000-0000-0000000000c1', 'like');
INSERT INTO public.swipes(from_id, to_id, kind)
VALUES ('57575757-0000-0000-0000-0000000000c1', '57575757-0000-0000-0000-0000000000b2', 'like');
INSERT INTO public.t_results SELECT 'p2: reciprocal like enqueues no like event for the second liker',
  count(*) = 0, count(*)::text FROM public.notification_outbox
  WHERE category = 'like' AND recipient_id = '57575757-0000-0000-0000-0000000000b2'::uuid
    AND actor_id = '57575757-0000-0000-0000-0000000000c1';
INSERT INTO public.t_results SELECT 'p2: reciprocal pair is not a valid incoming like',
  NOT public._like_is_valid('57575757-0000-0000-0000-0000000000c1','57575757-0000-0000-0000-0000000000b2'), 'mutual';

SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status = 'suspended' WHERE id = '57575757-0000-0000-0000-0000000000a2'; RESET request.jwt.claim.role;
INSERT INTO public.t_results SELECT 'p2: suspended liker is invalid',
  NOT public._like_is_valid('57575757-0000-0000-0000-0000000000a2','57575757-0000-0000-0000-0000000000b1'), 'suspended';
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status = 'active' WHERE id = '57575757-0000-0000-0000-0000000000a2'; RESET request.jwt.claim.role;

-- Blocked pair at insert time never enqueues
INSERT INTO public.blocks (blocker, blocked)
VALUES ('57575757-0000-0000-0000-0000000000c1', '57575757-0000-0000-0000-0000000000a2');
INSERT INTO public.swipes(from_id, to_id, kind)
VALUES ('57575757-0000-0000-0000-0000000000a2', '57575757-0000-0000-0000-0000000000c1', 'like');
INSERT INTO public.t_results SELECT 'p2: like toward a blocking member enqueues nothing',
  count(*) = 0, count(*)::text FROM public.notification_outbox
  WHERE category = 'like' AND actor_id = '57575757-0000-0000-0000-0000000000a2'
    AND recipient_id = '57575757-0000-0000-0000-0000000000c1'::uuid;

-- ---- Delivery-time suppression: a like that became invalid is not pushed ----
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.materialize_push_deliveries(100);
RESET ROLE;
-- liker1 -> free recipient was answered by the pass above, so its delivery must be suppressed
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT count(*) FROM public.claim_push_deliveries(100);
INSERT INTO public.t_results SELECT 'p2: answered like delivery is suppressed as LikeNoLongerValid',
  count(*) >= 1 AND bool_and(d.status = 'suppressed' AND d.last_error = 'LikeNoLongerValid'), count(*)::text
FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.category = 'like' AND o.actor_id = '57575757-0000-0000-0000-0000000000a1'
  AND o.recipient_id = '57575757-0000-0000-0000-0000000000b1'::uuid;
INSERT INTO public.t_results SELECT 'p2: still-valid like delivery is claimed (liker2 -> free recipient)',
  count(*) >= 1, count(*)::text
FROM public.notification_deliveries d JOIN public.notification_outbox o ON o.id = d.notification_id
WHERE o.category = 'like' AND o.actor_id = '57575757-0000-0000-0000-0000000000a2'
  AND o.recipient_id = '57575757-0000-0000-0000-0000000000b1'::uuid
  AND d.status IN ('processing', 'sent');
-- Retry: a second claim does not hand out the same in-flight delivery again
INSERT INTO public.t_results SELECT 'p2: retry claim does not re-issue in-flight like deliveries',
  count(*) = 0, count(*)::text FROM public.claim_push_deliveries(100) c WHERE c.category = 'like';
RESET ROLE;
-- Outbox itself never stores identity beyond the internal actor_id, and route_data stays empty
INSERT INTO public.t_results SELECT 'p2: like route_data carries no identity',
  bool_and(route_data = '{}'::jsonb), 'empty'
FROM public.notification_outbox WHERE category = 'like' AND event_id LIKE '57575757-%';
