\set ON_ERROR_STOP on
-- get_my_sent_likes: premium-only "profiles I liked" list.
-- Users: P premium (the caller), F free, X another premium member, T1/T2 liked targets, M matched target,
-- PS a profile P only passed, BL blocked target, SU suspended target.
INSERT INTO auth.users(id, email) VALUES
  ('69696969-0000-0000-0000-0000000000a1', 'sl-premium@x'),
  ('69696969-0000-0000-0000-0000000000a2', 'sl-free@x'),
  ('69696969-0000-0000-0000-0000000000a3', 'sl-other-premium@x'),
  ('69696969-0000-0000-0000-0000000000b1', 'sl-t1@x'),
  ('69696969-0000-0000-0000-0000000000b2', 'sl-t2@x'),
  ('69696969-0000-0000-0000-0000000000b3', 'sl-matched@x'),
  ('69696969-0000-0000-0000-0000000000b4', 'sl-passed@x'),
  ('69696969-0000-0000-0000-0000000000b5', 'sl-blocked@x'),
  ('69696969-0000-0000-0000-0000000000b6', 'sl-suspended@x');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000a1', 'Premium Caller', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000a2', 'Free Caller', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000a3', 'Other Premium', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b1', 'Target One', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b2', 'Target Two', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b3', 'Target Matched', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b4', 'Target Passed', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b5', 'Target Blocked', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('69696969-0000-0000-0000-0000000000b6', 'Target Suspended', '1996-01-01', 'woman', 'man');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES
  ('69696969-0000-0000-0000-0000000000a1', 'premium', 'active', now() + interval '30 days'),
  ('69696969-0000-0000-0000-0000000000a3', 'vip', 'active', now() + interval '30 days');

INSERT INTO public.swipes(from_id, to_id, kind, created_at) VALUES
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b1', 'like',     now() - interval '3 hours'),
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b2', 'priority', now() - interval '2 hours'),
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b3', 'like',     now() - interval '1 hour'),
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b4', 'pass',     now()),
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b5', 'like',     now()),
  ('69696969-0000-0000-0000-0000000000a1', '69696969-0000-0000-0000-0000000000b6', 'like',     now()),
  -- someone else's likes must never show up for the caller
  ('69696969-0000-0000-0000-0000000000a3', '69696969-0000-0000-0000-0000000000b1', 'like',     now()),
  ('69696969-0000-0000-0000-0000000000a3', '69696969-0000-0000-0000-0000000000b4', 'like',     now());
INSERT INTO public.matches (user_a, user_b) VALUES
  (least('69696969-0000-0000-0000-0000000000a1','69696969-0000-0000-0000-0000000000b3'),
   greatest('69696969-0000-0000-0000-0000000000a1','69696969-0000-0000-0000-0000000000b3'));
INSERT INTO public.blocks (blocker, blocked)
  VALUES ('69696969-0000-0000-0000-0000000000b5', '69696969-0000-0000-0000-0000000000a1');
SET request.jwt.claim.role='service_role';
UPDATE public.profiles SET status = 'suspended' WHERE id = '69696969-0000-0000-0000-0000000000b6';
RESET request.jwt.claim.role;

-- ---- Free member: denied, a forged tier claim changes nothing ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '69696969-0000-0000-0000-0000000000a2';
CALL public.expect_fail('sent likes: free member is refused (upgrade_required)',
  $q$SELECT * FROM public.get_my_sent_likes(50, NULL)$q$);
SET request.jwt.claims = '{"role":"authenticated","sub":"69696969-0000-0000-0000-0000000000a2","tier":"vip","app_metadata":{"tier":"vip","premium":true}}';
CALL public.expect_fail('sent likes: forged vip claim does not unlock the list',
  $q$SELECT * FROM public.get_my_sent_likes(50, NULL)$q$);
RESET request.jwt.claims;
RESET ROLE;

-- ---- Premium member: exactly their own valid outgoing likes, newest first ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '69696969-0000-0000-0000-0000000000a1';
INSERT INTO public.t_results SELECT 'sent likes: premium sees only the visible profiles they liked (2 likes + 1 match)',
  count(*) = 3 AND bool_and(id IN ('69696969-0000-0000-0000-0000000000b1','69696969-0000-0000-0000-0000000000b2','69696969-0000-0000-0000-0000000000b3')),
  count(*)::text FROM public.get_my_sent_likes(50, NULL);
INSERT INTO public.t_results SELECT 'sent likes: newest first',
  array_agg(id ORDER BY liked_at DESC) = ARRAY['69696969-0000-0000-0000-0000000000b3','69696969-0000-0000-0000-0000000000b2','69696969-0000-0000-0000-0000000000b1'],
  'order' FROM public.get_my_sent_likes(50, NULL);
INSERT INTO public.t_results SELECT 'sent likes: is_match true only for the matched profile',
  bool_and((id = '69696969-0000-0000-0000-0000000000b3') = is_match), 'match flag'
  FROM public.get_my_sent_likes(50, NULL);
INSERT INTO public.t_results SELECT 'sent likes: a pass is never listed',
  count(*) = 0, count(*)::text FROM public.get_my_sent_likes(50, NULL) WHERE id = '69696969-0000-0000-0000-0000000000b4';
INSERT INTO public.t_results SELECT 'sent likes: blocked and suspended profiles are hidden',
  count(*) = 0, count(*)::text FROM public.get_my_sent_likes(50, NULL)
  WHERE id IN ('69696969-0000-0000-0000-0000000000b5','69696969-0000-0000-0000-0000000000b6');
INSERT INTO public.t_results SELECT 'sent likes: priority like keeps its kind',
  kind = 'priority', kind FROM public.get_my_sent_likes(50, NULL) WHERE id = '69696969-0000-0000-0000-0000000000b2';
INSERT INTO public.t_results SELECT 'sent likes: pagination with _before',
  count(*) = 2, count(*)::text FROM public.get_my_sent_likes(50, now() - interval '90 minutes');
INSERT INTO public.t_results SELECT 'sent likes: limit is honoured',
  count(*) = 1, count(*)::text FROM public.get_my_sent_likes(1, NULL);
CALL public.expect_fail('sent likes: limit 0 rejected', $q$SELECT * FROM public.get_my_sent_likes(0, NULL)$q$);
CALL public.expect_fail('sent likes: limit 101 rejected', $q$SELECT * FROM public.get_my_sent_likes(101, NULL)$q$);
RESET ROLE;

-- ---- Another premium member only ever sees their own likes ----
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '69696969-0000-0000-0000-0000000000a3';
INSERT INTO public.t_results SELECT 'sent likes: another member sees only their own likes',
  count(*) = 2 AND bool_and(id IN ('69696969-0000-0000-0000-0000000000b1','69696969-0000-0000-0000-0000000000b4')),
  count(*)::text FROM public.get_my_sent_likes(50, NULL);
RESET ROLE;

-- ---- Anonymous callers ----
SET ROLE anon;
CALL public.expect_fail('sent likes: anon cannot call get_my_sent_likes', $q$SELECT * FROM public.get_my_sent_likes(50, NULL)$q$);
RESET ROLE;

-- ---- Expired subscription loses access immediately ----
UPDATE public.user_subscriptions SET expires_at = now() - interval '1 minute'
  WHERE user_id = '69696969-0000-0000-0000-0000000000a1';
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '69696969-0000-0000-0000-0000000000a1';
CALL public.expect_fail('sent likes: an expired subscription is refused', $q$SELECT * FROM public.get_my_sent_likes(50, NULL)$q$);
RESET ROLE;
