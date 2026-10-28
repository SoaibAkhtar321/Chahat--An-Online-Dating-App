\set ON_ERROR_STOP on
-- 20260101006100: selfie-verification review (service_role, audited) and the public Verified badge lookup.
INSERT INTO auth.users(id, email) VALUES
  ('76000000-0000-0000-0000-00000000000a', 'vb-a@x'), ('76000000-0000-0000-0000-00000000000b', 'vb-b@x'),
  ('76000000-0000-0000-0000-00000000000c', 'vb-c@x'), ('76000000-0000-0000-0000-00000000000d', 'vb-d@x'),
  ('76000000-0000-0000-0000-0000000000ad', 'vb-admin@x');
CALL public.test_complete_profile('76000000-0000-0000-0000-00000000000a', 'VbA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('76000000-0000-0000-0000-00000000000b', 'VbB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('76000000-0000-0000-0000-00000000000c', 'VbC', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('76000000-0000-0000-0000-00000000000d', 'VbD', '1996-01-01', 'woman', 'man');
CREATE TABLE public.t76 (k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t76 TO PUBLIC;

-- B and C submit (client may set pending); D never submits.
SET ROLE authenticated;
SET request.jwt.claim.sub = '76000000-0000-0000-0000-00000000000b';
UPDATE public.account_state SET data = coalesce(data, '{}'::jsonb) || '{"verification":{"status":"pending"}}' WHERE user_id = auth.uid();
CALL public.expect_fail('vb: a member cannot self-approve',
  $q$UPDATE public.account_state SET data = data || '{"verification":{"status":"approved"}}' WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('vb: a member cannot call review_verification',
  $q$SELECT public.review_verification('76000000-0000-0000-0000-00000000000b', 'approved', '76000000-0000-0000-0000-00000000000b')$q$);
SET request.jwt.claim.sub = '76000000-0000-0000-0000-00000000000c';
UPDATE public.account_state SET data = coalesce(data, '{}'::jsonb) || '{"verification":{"status":"pending"}}' WHERE user_id = auth.uid();
RESET ROLE;

-- Admin tool (service_role) reviews.
SET ROLE service_role;
SELECT public.review_verification('76000000-0000-0000-0000-00000000000b', 'approved', '76000000-0000-0000-0000-0000000000ad', 'ok');
SELECT public.review_verification('76000000-0000-0000-0000-00000000000c', 'rejected', '76000000-0000-0000-0000-0000000000ad', 'blurry');
CALL public.expect_fail('vb: a never-submitted verification cannot be approved',
  $q$SELECT public.review_verification('76000000-0000-0000-0000-00000000000d', 'approved', '76000000-0000-0000-0000-0000000000ad')$q$);
CALL public.expect_fail('vb: invalid status is refused',
  $q$SELECT public.review_verification('76000000-0000-0000-0000-00000000000c', 'maybe', '76000000-0000-0000-0000-0000000000ad')$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'vb: approvals and rejections are audited',
  (SELECT count(*) FROM public.admin_audit WHERE target IN ('76000000-0000-0000-0000-00000000000b','76000000-0000-0000-0000-00000000000c')
     AND action IN ('verification_approved','verification_rejected')) = 2, '';

-- A looks at B, C, D: only B carries the badge.
SET ROLE authenticated; SET request.jwt.claim.sub = '76000000-0000-0000-0000-00000000000a';
INSERT INTO public.t76 SELECT 'a_sees', coalesce(jsonb_agg(x ORDER BY x), '[]') FROM public.get_verified_profile_ids(ARRAY[
  '76000000-0000-0000-0000-00000000000b','76000000-0000-0000-0000-00000000000c','76000000-0000-0000-0000-00000000000d']) x;
CALL public.expect_fail('vb: at most 100 ids per lookup',
  $q$SELECT public.get_verified_profile_ids(array_fill('x'::text, ARRAY[101]))$q$);
CALL public.expect_fail('vb: members cannot read another member''s verification state directly',
  $q$SELECT 1/(count(*)::int) FROM public.account_state WHERE user_id = '76000000-0000-0000-0000-00000000000b'$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('vb: anon cannot look up badges', $q$SELECT public.get_verified_profile_ids(ARRAY['76000000-0000-0000-0000-00000000000b'])$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'vb: only the approved profile carries the badge', v = '["76000000-0000-0000-0000-00000000000b"]'::jsonb, v::text
FROM public.t76 WHERE k = 'a_sees';

-- Blocked or suspended profiles reveal nothing.
INSERT INTO public.blocks(blocker, blocked) VALUES ('76000000-0000-0000-0000-00000000000b', '76000000-0000-0000-0000-00000000000a');
SET ROLE authenticated; SET request.jwt.claim.sub = '76000000-0000-0000-0000-00000000000a';
INSERT INTO public.t76 SELECT 'a_after_block', coalesce(jsonb_agg(x), '[]') FROM public.get_verified_profile_ids(ARRAY['76000000-0000-0000-0000-00000000000b']) x;
RESET ROLE;
INSERT INTO public.t_results SELECT 'vb: a blocked pair sees no badge', v = '[]'::jsonb, v::text FROM public.t76 WHERE k = 'a_after_block';

-- Brand wording in user-facing database errors.
INSERT INTO public.t_results SELECT 'brand: user-facing profile errors say Chahat, not Milo',
  prosrc NOT LIKE '%Milo%' AND prosrc LIKE '%to use Chahat%', ''
FROM pg_proc WHERE proname = 'profiles_guard';
