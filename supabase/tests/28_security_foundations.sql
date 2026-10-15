\set ON_ERROR_STOP on
-- 28_security_foundations.sql
-- Automated PostgreSQL tests for Phase B / B.1 security foundations:
--   1. Block Isolation: matches, messages, chat storage, and public profile access.
--   2. Block Cleanup Trigger: deletes only intended match and swipes, preserves unrelated pairs.
--   3. Verification Guard: blocks client self-approval & metadata tampering; allows service_role.
--   4. Preserved Approval: verified status cannot be cleared by client preference updates.
--   5. Account Deletion: complete purge_user_data cleanup with audit logging.

-- 1. Setup isolated test users (b1, b2, b3)
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1','b1@x'),
  ('00000000-0000-0000-0000-0000000000b2','b2@x'),
  ('00000000-0000-0000-0000-0000000000b3','b3@x');

CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000b1', 'B1', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000b2', 'B2', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000b3', 'B3', '1996-01-01', 'woman', 'man');

-- 2. Setup initial matches, messages, and swipes
-- Match 1: B1 and B2
INSERT INTO public.matches (id, user_a, user_b) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.messages (id, match_id, sender, body) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'hello b2');
INSERT INTO public.swipes (from_id, to_id, kind) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'like'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'like');

-- Match 2: B1 and B3 (unrelated control match)
INSERT INTO public.matches (id, user_a, user_b) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3');
INSERT INTO public.swipes (from_id, to_id, kind) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3', 'like'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', 'like');

-- 3. Verify access BEFORE block
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b1';
INSERT INTO public.t_results SELECT 'unblocked: B1 sees match with B2', count(*)=1, count(*)::text FROM public.matches WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'unblocked: B1 sees messages with B2', count(*)=1, count(*)::text FROM public.messages WHERE match_id='bbbbbbbb-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'unblocked: B1 sees public profile of B2', count(*)=1, count(*)::text FROM public.get_public_profile('00000000-0000-0000-0000-0000000000b2');

-- 4. B1 blocks B2
INSERT INTO public.blocks (blocker, blocked) VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
RESET ROLE;

-- 5. Verify trigger cleanup (on_block_cleanup)
INSERT INTO public.t_results SELECT 'on_block_cleanup: match B1-B2 deleted from DB', count(*)=0, count(*)::text FROM public.matches WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'on_block_cleanup: messages B1-B2 cascaded', count(*)=0, count(*)::text FROM public.messages WHERE match_id='bbbbbbbb-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'on_block_cleanup: swipes B1-B2 deleted', count(*)=0, count(*)::text FROM public.swipes WHERE (from_id='00000000-0000-0000-0000-0000000000b1' AND to_id='00000000-0000-0000-0000-0000000000b2') OR (from_id='00000000-0000-0000-0000-0000000000b2' AND to_id='00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.t_results SELECT 'on_block_cleanup: unrelated match B1-B3 preserved', count(*)=1, count(*)::text FROM public.matches WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'on_block_cleanup: unrelated swipes B1-B3 preserved', count(*)=2, count(*)::text FROM public.swipes WHERE (from_id='00000000-0000-0000-0000-0000000000b1' AND to_id='00000000-0000-0000-0000-0000000000b3') OR (from_id='00000000-0000-0000-0000-0000000000b3' AND to_id='00000000-0000-0000-0000-0000000000b1');

-- 6. Test RLS block isolation (even if match row existed)
SET ROLE service_role;
INSERT INTO public.matches (id, user_a, user_b) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b2';
INSERT INTO public.t_results SELECT 'blocked: B2 cannot read match via RLS', count(*)=0, count(*)::text FROM public.matches WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
INSERT INTO public.t_results SELECT 'blocked: is_match_member returns false for blocked pair', NOT public.is_match_member('bbbbbbbb-0000-0000-0000-000000000003'::uuid), 'ok';
INSERT INTO public.t_results SELECT 'blocked: chat_folder_member returns false for blocked pair', NOT public.chat_folder_member('bbbbbbbb-0000-0000-0000-000000000003'), 'ok';
INSERT INTO public.t_results SELECT 'blocked: get_public_profile returns 0 rows for blocker', count(*)=0, count(*)::text FROM public.get_public_profile('00000000-0000-0000-0000-0000000000b1');
RESET ROLE;

-- 7. Test Verification Guard (account_state_guard)
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b2';
CALL public.expect_fail('client cannot set verification status to approved',
  'UPDATE public.account_state SET data = ''{"verification":{"status":"approved"}}''::jsonb WHERE user_id = auth.uid()');
CALL public.expect_fail('client cannot tamper with verification metadata',
  'UPDATE public.account_state SET data = ''{"verification":{"status":"pending","verified_at":"2026-01-01"}}''::jsonb WHERE user_id = auth.uid()');
CALL public.expect_ok('client can set verification status to pending',
  'UPDATE public.account_state SET data = ''{"verification":{"status":"pending"}}''::jsonb WHERE user_id = auth.uid()');
CALL public.expect_ok('client can update preference keys',
  'UPDATE public.account_state SET data = ''{"ageMin":21,"ageMax":30,"distance":40,"verification":{"status":"pending"}}''::jsonb WHERE user_id = auth.uid()');
RESET ROLE;

-- 8. Legitimate server-side verification via service_role
SET ROLE service_role; SET request.jwt.claim.role='service_role';
CALL public.expect_ok('service_role can approve verification and set metadata',
  'UPDATE public.account_state SET data = ''{"ageMin":21,"ageMax":30,"distance":40,"verification":{"status":"approved","verified_at":"2026-01-01T00:00:00Z","reviewer":"admin"}}''::jsonb WHERE user_id = ''00000000-0000-0000-0000-0000000000b2''::uuid');
RESET request.jwt.claim.role; RESET ROLE;

-- 9. Verified status cannot be cleared or demoted by client
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b2';
UPDATE public.account_state SET data = '{"ageMin":22,"ageMax":32,"distance":50}'::jsonb WHERE user_id = auth.uid();
RESET ROLE;
INSERT INTO public.t_results SELECT 'approved verification preserved when client updates preferences',
  (data->'verification'->>'status')='approved' AND (data->'verification'->>'reviewer')='admin', data::text
  FROM public.account_state WHERE user_id='00000000-0000-0000-0000-0000000000b2'::uuid;

-- 10. Account deletion purge_user_data verification
SET ROLE service_role;
SELECT public.purge_user_data('00000000-0000-0000-0000-0000000000b3'::uuid);
RESET ROLE;
INSERT INTO public.t_results SELECT 'purge_user_data removes profile', count(*)=0, count(*)::text FROM public.profiles WHERE id='00000000-0000-0000-0000-0000000000b3';
INSERT INTO public.t_results SELECT 'purge_user_data removes account_state', count(*)=0, count(*)::text FROM public.account_state WHERE user_id='00000000-0000-0000-0000-0000000000b3'::uuid;
INSERT INTO public.t_results SELECT 'purge_user_data removes matches', count(*)=0, count(*)::text FROM public.matches WHERE user_a='00000000-0000-0000-0000-0000000000b3' OR user_b='00000000-0000-0000-0000-0000000000b3';
INSERT INTO public.t_results SELECT 'purge_user_data removes swipes', count(*)=0, count(*)::text FROM public.swipes WHERE from_id='00000000-0000-0000-0000-0000000000b3' OR to_id='00000000-0000-0000-0000-0000000000b3';
INSERT INTO public.t_results
SELECT 'purge_user_data writes anonymized admin_audit row',
  count(*) = 1,
  count(*)::text
FROM public.admin_audit
WHERE target = 'deleted:' || md5('00000000-0000-0000-0000-0000000000b3')
  AND action = 'account_self_deleted';
